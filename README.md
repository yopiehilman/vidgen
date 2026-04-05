# Run the app locally

This project now runs as an integrated app:
- React + Vite for the dashboard UI
- Express for internal API routes
- Gemini is called from the server, not directly from the browser

## Run locally

Prerequisites: Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local`
3. Set `GEMINI_API_KEY` in `.env.local`
4. Run the app:
   `npm run dev`

Open `http://localhost:3000`.

## Other scripts

- `npm run build` builds the frontend into `dist/`
- `npm run start` starts the integrated server
- `npm run lint` runs TypeScript type-checking
