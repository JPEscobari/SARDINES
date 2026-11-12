
import os
from dotenv import load_dotenv
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

load_dotenv()

client = WebClient(token=os.environ["SLACK_USER_TOKEN"])

CHANNEL_ID = "C0CFN8D6JD8"
THREAD_TS = "1793996268.380809"

try:
    result = client.conversations_replies(
        channel=CHANNEL_ID,
        ts=THREAD_TS,
        limit=15
    )

    messages = result.get("messages", [])

    print(f"Successfully retrieved {len(messages)} messages!")

    for message in messages:
        print(
            f"[{message['ts']}] "
            f"{message.get('user', 'Unknown')}: "
            f"{message.get('text', '')}"
        )

    if result.get("has_more") or result.get(
        "response_metadata", {}
    ).get("next_cursor"):
        print("WARNING: More messages exist; pagination is needed.")

except SlackApiError as e:
    print("Slack API error:", e.response.get("error"))
