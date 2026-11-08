# Contraza

Contract drafting and review app built with TanStack Start, Firebase Authentication, and Cloud Firestore.

## Local setup

1. Create a Firebase project and register a Web app.
2. In Firebase Console, enable **Authentication → Sign-in method → Email/Password** and create a **Cloud Firestore** database.
3. Copy `.env.example` to `.env` and fill in the Web app config values from **Project settings → General**.
4. Create a Firebase service account for the server-side functions. Keep its JSON key in the project root using an ignored filename such as `firebase-service-account.json`, then set `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json` in `.env`. The Admin backend also needs `FIREBASE_PROJECT_ID`. Never commit or share the service-account JSON.
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

AI drafting, contract review, and review edits use the Gemini API from server-side functions. Add your Google AI Studio key as `GEMINI_API_KEY` in `.env`; it is never exposed to the browser. The app uses `gemini-3.8-flash`. Review Google AI Studio's current usage limits and data terms before sending contract documents; free-tier prompts may be used to improve Google's products, so don't submit confidential contracts unless that use is acceptable.
