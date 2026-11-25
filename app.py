"""Unauthenticated REST API for events and event registrations."""

import os
from uuid import UUID

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from postgrest import APIError
from supabase import Client, create_client

load_dotenv()

app = Flask(__name__)

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
supabase: Client | None = (
    create_client(supabase_url, supabase_key) if supabase_url and supabase_key else None
)


def valid_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        UUID(value)
        return True
    except ValueError:
        return False


def database():
    if supabase is None:
        return None, (jsonify(error="Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."), 503)
    return supabase, None


def api_error(error: APIError):
    """Return a useful HTTP response without leaking database internals."""
    code = getattr(error, "code", None)
    if code == "23505":
        return jsonify(error="You are already registered for this event."), 409
    app.logger.exception("Supabase request failed", exc_info=error)
    return jsonify(error="Database request failed."), 500


@app.get("/")
def index():
    return jsonify(name="Events API", endpoints=[
        "GET /api/events",
        "GET /api/events/<id>",
        "POST /api/registrations",
        "GET /api/me/registrations?user_id=<uuid>",
        "GET /api/events/<id>/registrations?organizer_id=<uuid>",
    ])


@app.get("/api/events")
def list_events():
    client, problem = database()
    if problem:
        return problem
    try:
        query = client.table("events").select("id, organizer_id, title, capacity, status")
        status = request.args.get("status")
        if status:
            query = query.eq("status", status)
        response = query.order("title").limit(100).execute()
        return jsonify(data=response.data)
    except APIError as error:
        return api_error(error)


@app.get("/api/events/<event_id>")
def get_event(event_id):
    if not valid_uuid(event_id):
        return jsonify(error="event id must be a UUID."), 400
    client, problem = database()
    if problem:
        return problem
    try:
        response = (
            client.table("events")
            .select("id, organizer_id, title, capacity, status")
            .eq("id", event_id)
            .limit(1)
            .execute()
        )
        if not response.data:
            return jsonify(error="Event not found."), 404
        return jsonify(data=response.data[0])
    except APIError as error:
        return api_error(error)


@app.post("/api/registrations")
def create_registration():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="Request body must be a JSON object."), 400
    user_id = body.get("user_id")
    event_id = body.get("event_id")
    if not valid_uuid(user_id) or not valid_uuid(event_id):
        return jsonify(error="user_id and event_id must be UUIDs."), 400

    client, problem = database()
    if problem:
        return problem
    try:
        user_response = client.table("users").select("id").eq("id", user_id).limit(1).execute()
        if not user_response.data:
            return jsonify(error="User not found."), 404

        event_response = (
            client.table("events")
            .select("id, capacity, status")
            .eq("id", event_id)
            .limit(1)
            .execute()
        )
        if not event_response.data:
            return jsonify(error="Event not found."), 404
        event = event_response.data[0]
        if event.get("status") and event["status"].lower() in (
            "closed", "cancelled", "canceled", "completed"
        ):
            return jsonify(error="Event is not open for registration."), 409

        existing = (
            client.table("registrations")
            .select("id")
            .eq("user_id", user_id)
            .eq("event_id", event_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            return jsonify(error="You are already registered for this event."), 409

        capacity = event.get("capacity")
        if capacity is not None:
            registrations = (
                client.table("registrations")
                .select("id", count="exact")
                .eq("event_id", event_id)
                .execute()
            )
            if (registrations.count or len(registrations.data)) >= capacity:
                return jsonify(error="Event is at capacity."), 409

        created = (
            client.table("registrations")
            .insert({"user_id": user_id, "event_id": event_id})
            .select("id, user_id, event_id, created_at")
            .execute()
        )
        return jsonify(data=created.data[0]), 201
    except APIError as error:
        return api_error(error)


@app.get("/api/me/registrations")
def list_user_registrations():
    user_id = request.args.get("user_id")
    if not valid_uuid(user_id):
        return jsonify(error="user_id query parameter must be a UUID."), 400
    client, problem = database()
    if problem:
        return problem
    try:
        response = (
            client.table("registrations")
            .select("id, user_id, event_id, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        return jsonify(data=response.data)
    except APIError as error:
        return api_error(error)


@app.get("/api/events/<event_id>/registrations")
def list_event_registrations(event_id):
    organizer_id = request.args.get("organizer_id")
    if not valid_uuid(event_id) or not valid_uuid(organizer_id):
        return jsonify(error="event id and organizer_id query parameter must be UUIDs."), 400
    client, problem = database()
    if problem:
        return problem
    try:
        event_response = (
            client.table("events")
            .select("id, organizer_id")
            .eq("id", event_id)
            .limit(1)
            .execute()
        )
        if not event_response.data:
            return jsonify(error="Event not found."), 404
        if event_response.data[0]["organizer_id"] != organizer_id:
            return jsonify(error="Only the event organizer can view its registrations."), 403

        response = (
            client.table("registrations")
            .select("id, user_id, event_id, created_at")
            .eq("event_id", event_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        rows = response.data
        user_ids = list({row["user_id"] for row in rows})
        emails = {}
        if user_ids:
            users_response = client.table("users").select("id, email").in_("id", user_ids).execute()
            emails = {user["id"]: user.get("email") for user in users_response.data}
        for row in rows:
            row["email"] = emails.get(row["user_id"])
        return jsonify(data=rows)
    except APIError as error:
        return api_error(error)


@app.errorhandler(404)
def not_found(_error):
    return jsonify(error="Route not found."), 404


@app.errorhandler(405)
def method_not_allowed(_error):
    return jsonify(error="Method not allowed."), 405


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
