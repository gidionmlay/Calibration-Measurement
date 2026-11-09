"""Pydantic v2 schemas for Audit responses."""

import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class AuditEventResponseSchema(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    sequence_num: int
    event_type: str
    actor_id: str
    client_operation_id: Optional[uuid.UUID]
    timestamp: datetime
    event_summary: str
    affected_field: Optional[str]
    before_value: Optional[str]
    after_value: Optional[str]
    override_reason: Optional[str]
    payload: Dict[str, Any]
    previous_event_hash: str
    event_hash: str


class AuditVerificationResponseSchema(BaseModel):
    is_valid: bool
    total_events: int
    verified_events: int
    errors: List[str] = Field(default_factory=list)

