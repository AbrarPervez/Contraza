# Contraza

Contract drafting and review app built with TanStack Start, Firebase Authentication, and Cloud Firestore.

## Local setup

1. Create a Firebase project and register a Web app. Enable **Authentication → Sign-in method → Email/Password** and create a **Cloud Firestore** database.
2. Update the public web settings in [`src/integrations/firebase/firebase-config.ts`](./src/integrations/firebase/firebase-config.ts) with the values from **Project settings → General → Your apps**. These client settings are public; do not put service-account credentials or API keys for Gemini in this file.
3. Create a Firebase service account with the permissions needed by Firebase Admin, and copy its project ID, client email, and private key into `.env` as `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Keep the private key and Gemini API key out of source control.
4. Copy `.env.example` to `.env` and set those server credentials and `GEMINI_API_KEY`. In PowerShell, run `Copy-Item .env.example .env`. `.env` is ignored by Git; never commit it.
5. Deploy the Firestore security rules from the project root:

   ```powershell
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project your-project-id
   ```

6. Install dependencies and start the app:

   ```powershell
   npm install
   npm run dev -- --host 127.0.0.1 --port 8080
   ```

AI drafting, contract review, and review edits use the Gemini API from server-side functions. `GEMINI_API_KEY` is read from `.env` and is never exposed to the browser. The app uses `gemini-3.8-flash`. Review Google AI Studio's current usage limits and data terms before sending contract documents; free-tier prompts may be used to improve Google's products, so don't submit confidential contracts unless that use is acceptable.
