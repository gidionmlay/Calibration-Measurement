"""Pydantic schemas for Admin Overview metrics and dashboard."""

from datetime import datetime
from typing import List, Optional
import uuid
from pydantic import BaseModel, ConfigDict


class MonthlyActivityItem(BaseModel):
    month: str  # Format: "YYYY-MM"
    session_count: int
    report_count: int


class RecentSessionItem(BaseModel):
    id: uuid.UUID
    reference: str
    measurer_name: str
    course_name: Optional[str] = None
    course_length_m: str
    status: str
    is_provisional: bool
    created_at: datetime


class FieldMeasurerItem(BaseModel):
    id: uuid.UUID
    display_name: str
    email: Optional[str] = None
    organization: Optional[str] = None
    status: str
    roles: List[str] = ["measurer"]
    session_count: int = 0
    created_at: datetime


class AdminOverviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    total_users: int
    total_sessions: int
    total_finalized_reports: int
    total_draft_sessions: int
    monthly_activity: List[MonthlyActivityItem]
    recent_activity: List[RecentSessionItem]
    measurers: List[FieldMeasurerItem] = []

