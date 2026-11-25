# Events API

Flask API backed by the Supabase `public` schema. It implements the endpoints
from `api.png` against the `events`, `registrations`, and `users` tables in
`database.png`.

## Run locally

The existing `.env` file should define `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`. Never put a Supabase secret/service role key in a
client app.

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python app.py
```

The development server listens on `http://127.0.0.1:5000` by default. Set
`PORT` to change the port.

## Deploy to Render

The repository-root `render.yaml` defines a Render web service with `backend`
as its root directory. Create a Blueprint from the repository, then set
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the service environment. Render
installs `requirements.txt` and serves the app with Gunicorn; the service binds
to Render's assigned `$PORT`.

## Endpoints

All successful responses use `{ "data": ... }`. Errors use
`{ "error": "..." }`.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/events` | Lists up to 100 events. Optional `?status=...` filter. |
| GET | `/api/events/<id>` | Returns one event or 404. |
| POST | `/api/registrations` | Creates a registration; returns 201, or 409 for duplicates, full events, or closed events. JSON: `{"user_id":"<uuid>","event_id":"<uuid>"}`. |
| GET | `/api/me/registrations?user_id=<uuid>` | Lists registrations for the supplied user. |
| GET | `/api/events/<id>/registrations?organizer_id=<uuid>` | Lists attendee registrations and user emails after checking the supplied ID against the event organizer. |

## No-auth behavior

No login or token is required. The caller supplies `user_id` or
`organizer_id` directly. These values are claims, not verified identities:
anyone who can reach this API can impersonate another user, create registrations
for them, or pass an organizer's ID to view attendee data. Add authentication
and ownership checks before exposing this API to the public internet.

The Supabase publishable key uses the `anon` database role. Supabase table
grants and RLS policies still apply, so the three tables must permit the
intended operations for that role. The backend deliberately does not disable
RLS or use a service role key to bypass those controls.
