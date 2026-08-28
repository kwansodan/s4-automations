"""Inngest Client instance and registration."""

import inngest
from app.config import settings

# Initialize the durable Inngest client
inngest_client = inngest.Inngest(
    app_id=settings.INNGEST_APP_ID,
    event_key=settings.INNGEST_EVENT_KEY,
    signing_key=settings.INNGEST_SIGNING_KEY,
    is_production=(settings.ENVIRONMENT == "production"),
)
