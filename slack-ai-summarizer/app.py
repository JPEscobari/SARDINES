
import os
import json
import time
import logging
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from test_watsonx import summarize_slack_messages

load_dotenv()
logging.basicConfig(level=logging.INFO)

app = App(token=os.environ["SLACK_BOT_TOKEN"])

reader = WebClient(
    token=os.environ["SLACK_USER_TOKEN"]
)

executor = ThreadPoolExecutor(max_workers=2)

MAX_MESSAGES = 15


def option(label, value):
    return {
        "text": {"type": "plain_text", "text": label},
        "value": value
    }


@app.shortcut("summarize_conversation")
def open_summary_modal(ack, body, client):
    ack()

    channel_id = body["channel"]["id"]
    message = body["message"]
    thread_ts = message.get("thread_ts") or message["ts"]

    options = [
        option("Last 12 hours", "12"),
        option("Last 24 hours", "24"),
        option("Last 72 hours", "72"),
        option("Last 7 days", "168")
    ]

    client.views_open(
        trigger_id=body["trigger_id"],
        view={
            "type": "modal",
            "callback_id": "summary_submit",
            "title": {
                "type": "plain_text",
                "text": "AI Chat Summary"
            },
            "submit": {
                "type": "plain_text",
                "text": "Generate"
            },
            "close": {
                "type": "plain_text",
                "text": "Cancel"
            },
            "private_metadata": json.dumps({
                "channel_id": channel_id,
                "thread_ts": thread_ts
            }),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "*Summarize current thread*"
                    }
                },
                {
                    "type": "input",
                    "block_id": "range_block",
                    "label": {
                        "type": "plain_text",
                        "text": "Time range"
                    },
                    "element": {
                        "type": "static_select",
                        "action_id": "time_range",
                        "options": options,
                        "initial_option": options[1]
                    }
                }
            ]
        }
    )


def fetch_thread_messages(channel_id, thread_ts, hours):
    cutoff = time.time() - hours * 3600

    response = reader.conversations_replies(
        channel=channel_id,
        ts=thread_ts,
        limit=MAX_MESSAGES
    )

    # Refuse incomplete summaries until pagination is implemented.
    if response.get("has_more") or response.get(
        "response_metadata", {}
    ).get("next_cursor"):
        raise RuntimeError(
            "Thread is too long for this MVP. "
            "Pagination is required."
        )

    messages = []

    for msg in response.get("messages", []):
        if float(msg["ts"]) < cutoff:
            continue

        if not msg.get("text"):
            continue

        messages.append({
            "time": datetime.fromtimestamp(
                float(msg["ts"]),
                tz=timezone.utc
            ).isoformat(),
            "user": msg.get("user", "Unknown"),
            "text": msg["text"]
        })

    return sorted(messages, key=lambda m: m["time"])


def generate_and_send_summary(
    client, channel_id, thread_ts, user_id, hours
):
    try:
        print("1. Fetching Slack messages...", flush=True)

        messages = fetch_thread_messages(
            channel_id, thread_ts, hours
        )

        print(
            f"2. Retrieved {len(messages)} messages.",
            flush=True
        )

        if not messages:
            summary = "No messages found in the selected time range."
        else:
            print("3. Calling IBM Granite...", flush=True)

            summary = summarize_slack_messages(messages)

            print("4. IBM summary generated!", flush=True)

        # Deliver only to the requesting user.
        client.chat_postMessage(
            channel=user_id,
            text=(
                ":sparkles: *AI Conversation Summary*\n"
                f"*Time range:* Last {hours} hours\n"
                f"*Messages analyzed:* {len(messages)}\n\n"
                f"{summary}"
            )
        )

        print("5. Summary sent to Slack!", flush=True)

    except Exception:
        logging.exception("Summary generation failed")

        try:
            client.chat_postMessage(
                channel=user_id,
                text=(
                    ":warning: *AI Summary failed*\n"
                    "Check the local application logs. "
                    "No summary was generated."
                )
            )
        except SlackApiError:
            logging.exception("Unable to send error notification")


@app.view("summary_submit")
def handle_submit(ack, body, view, client):
    hours = int(
        view["state"]["values"]
        ["range_block"]["time_range"]
        ["selected_option"]["value"]
    )

    metadata = json.loads(view["private_metadata"])

    # Slack requires a fast acknowledgment.
    ack()

    print(
        f"Summary requested: "
        f"channel={metadata['channel_id']} "
        f"thread={metadata['thread_ts']} "
        f"hours={hours}",
        flush=True
    )

    executor.submit(
        generate_and_send_summary,
        client,
        metadata["channel_id"],
        metadata["thread_ts"],
        body["user"]["id"],
        hours
    )


if __name__ == "__main__":
    print("Starting Slack AI Summarizer...")
    SocketModeHandler(
        app,
        os.environ["SLACK_APP_TOKEN"]
    ).start()
