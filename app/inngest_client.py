import os
import inngest
from app.config import settings

# Detect if a real Inngest Cloud signing key is configured
has_cloud_signing_key = bool(
    settings.INNGEST_SIGNING_KEY
    and settings.INNGEST_SIGNING_KEY.strip()
    and settings.INNGEST_SIGNING_KEY.strip() != "dev-signing-key"
)

# Detect if local dev server is explicitly targeted
has_dev_server = bool(settings.INNGEST_DEV_SERVER_URL and not has_cloud_signing_key)

if has_cloud_signing_key:
    # 1. Inngest Cloud Mode (Production / Staging Sync)
    signing_key = settings.INNGEST_SIGNING_KEY.strip()
    event_key = settings.INNGEST_EVENT_KEY.strip() if (settings.INNGEST_EVENT_KEY and settings.INNGEST_EVENT_KEY != "dev-event-key") else None
    
    os.environ["INNGEST_SIGNING_KEY"] = signing_key
    os.environ.pop("INNGEST_DEV", None)
    os.environ.pop("INNGEST_BASE_URL", None)

    inngest_client = inngest.Inngest(
        app_id=settings.INNGEST_APP_ID,
        signing_key=signing_key,
        event_key=event_key,
        is_production=True,
    )
elif has_dev_server:
    # 2. Local Inngest Dev Server Mode
    dev_url = settings.INNGEST_DEV_SERVER_URL.strip()
    os.environ["INNGEST_BASE_URL"] = dev_url
    os.environ["INNGEST_DEV"] = "1"
    os.environ.pop("INNGEST_SIGNING_KEY", None)
    os.environ.pop("INNGEST_EVENT_KEY", None)

    inngest_client = inngest.Inngest(
        app_id=settings.INNGEST_APP_ID,
        api_base_url=dev_url,
        event_api_base_url=dev_url,
        is_production=False,
    )
else:
    # 3. Default Local Standalone Mode
    os.environ.pop("INNGEST_SIGNING_KEY", None)
    os.environ.pop("INNGEST_EVENT_KEY", None)

    inngest_client = inngest.Inngest(
        app_id=settings.INNGEST_APP_ID,
        is_production=False,
    )



