#!/usr/bin/env python3
"""CLI utility to safely create or elevate administrative and operator accounts.

Enables platform operators to seed the initial system administrator or admin account
with secure scrypt-hashed credentials and RBAC role assignments without direct SQL edits.

Usage:
    python backend/scripts/create_admin.py --email admin@calibration.local --password "Secret123!"
    python backend/scripts/create_admin.py  (Interactive mode)
"""

import argparse
import getpass
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

# Ensure backend root is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.rbac import SystemRoles
from app.auth.security import hash_password
from app.core.database import SessionLocal
from app.models.rbac import Role, UserRole
from app.models.user import User

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_email(email: str) -> str:
    cleaned = email.strip().lower()
    if not cleaned or not EMAIL_REGEX.match(cleaned):
        raise ValueError(f"Invalid email address format: '{email}'")
    return cleaned


def validate_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    return password


def seed_admin_user(
    db: Session,
    email: str,
    password: Optional[str] = None,
    name: Optional[str] = None,
    role_name: str = "admin",
    organization: Optional[str] = None,
    update: bool = False,
) -> User:
    """Creates or updates an administrative user and assigns the specified security role.
    
    Args:
        db: SQLAlchemy session.
        email: User email address.
        password: Plaintext password (required for new user, optional on update).
        name: User display name.
        role_name: System role name (default: "admin").
        organization: Organization or affiliation name.
        update: If True, updates existing user credentials/profile.
        
    Returns:
        The created or updated User model instance.
    """
    cleaned_email = validate_email(email)
    norm_role = role_name.strip().lower()

    # Verify role existence
    role = db.query(Role).filter(Role.name == norm_role).first()
    if not role:
        valid_roles = [r.name for r in db.query(Role).all()]
        raise ValueError(
            f"Role '{norm_role}' does not exist in the database. Valid roles: {valid_roles}"
        )

    # Check for existing local user
    user = (
        db.query(User)
        .filter(func.lower(User.email) == cleaned_email, User.issuer == "local")
        .first()
    )

    if user:
        if update:
            if password:
                validated_pw = validate_password(password)
                user.password_hash = hash_password(validated_pw)
            if name:
                user.display_name = name.strip()
            if organization:
                user.organization = organization.strip()
            user.updated_at = datetime.now(timezone.utc)
            db.flush()

        # Check existing active role assignment
        existing_assignment = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == user.id,
                UserRole.role_id == role.id,
                UserRole.revoked_at.is_(None),
            )
            .first()
        )

        if not existing_assignment:
            assignment = UserRole(
                user_id=user.id,
                role_id=role.id,
                assigned_by=None,
                assignment_reason=f"Role '{norm_role}' granted via CLI seeding tool",
            )
            db.add(assignment)

        db.commit()
        db.refresh(user)
        return user

    # New user creation
    if not password:
        raise ValueError("Password is required when creating a new administrative user.")

    validated_pw = validate_password(password)
    pw_hash = hash_password(validated_pw)

    new_user = User(
        id=uuid.uuid4(),
        issuer="local",
        subject=str(uuid.uuid4()),
        email=cleaned_email,
        display_name=(name or "Platform Administrator").strip(),
        organization=(organization or "Platform Administration").strip(),
        password_hash=pw_hash,
        email_verified=True,
        status="active",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(new_user)
    db.flush()

    assignment = UserRole(
        user_id=new_user.id,
        role_id=role.id,
        assigned_by=None,
        assignment_reason=f"Initial administrative seeding via CLI for role '{norm_role}'",
    )
    db.add(assignment)

    db.commit()
    db.refresh(new_user)
    return new_user


def parse_args(args: Optional[list] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed or manage administrative platform accounts.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--email",
        type=str,
        default=os.getenv("ADMIN_EMAIL"),
        help="Email address of the administrator account.",
    )
    parser.add_argument(
        "--password",
        type=str,
        default=os.getenv("ADMIN_PASSWORD"),
        help="Account password (min 8 characters). Prompted if omitted in interactive mode.",
    )
    parser.add_argument(
        "--name",
        type=str,
        default=os.getenv("ADMIN_NAME", "Platform Administrator"),
        help="Full display name.",
    )
    parser.add_argument(
        "--role",
        type=str,
        default=os.getenv("ADMIN_ROLE", SystemRoles.ADMIN),
        choices=[
            SystemRoles.ADMIN,
            SystemRoles.SUPERVISOR,
            SystemRoles.REVIEWER,
            SystemRoles.AUDITOR,
            SystemRoles.MEASURER,
        ],
        help="System role to grant.",
    )
    parser.add_argument(
        "--organization",
        type=str,
        default=os.getenv("ADMIN_ORG", "Platform Administration"),
        help="Organization or governing body affiliation.",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="Update password and profile if user already exists.",
    )
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        help="Fail immediately if required arguments are missing instead of prompting.",
    )
    return parser.parse_args(args)


def main() -> int:
    args = parse_args()

    email = args.email
    password = args.password
    name = args.name
    role = args.role
    org = args.organization
    is_interactive = not args.non_interactive and sys.stdin.isatty()

    # Interactive prompts if required values are not provided
    if not email:
        if is_interactive:
            email = input("Enter admin email address: ").strip()
        else:
            print("ERROR: --email is required in non-interactive mode.", file=sys.stderr)
            return 1

    if not password:
        if is_interactive:
            while True:
                pw1 = getpass.getpass("Enter password (min 8 chars): ")
                if len(pw1) < 8:
                    print("Password must be at least 8 characters long. Try again.")
                    continue
                pw2 = getpass.getpass("Confirm password: ")
                if pw1 != pw2:
                    print("Passwords do not match. Try again.")
                    continue
                password = pw1
                break
        else:
            print("ERROR: --password is required in non-interactive mode for new user.", file=sys.stderr)
            return 1

    db = SessionLocal()
    try:
        user = seed_admin_user(
            db=db,
            email=email,
            password=password,
            name=name,
            role_name=role,
            organization=org,
            update=args.update,
        )
        print("\n============================================================")
        print("  ADMINISTRATIVE USER READY")
        print("============================================================")
        print(f"  User ID:      {user.id}")
        print(f"  Email:        {user.email}")
        print(f"  Name:         {user.display_name}")
        print(f"  Organization: {user.organization}")
        print(f"  Role:         {role}")
        print(f"  Status:       {user.status}")
        print("============================================================\n")
        return 0
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"UNEXPECTED ERROR: {e}", file=sys.stderr)
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())

