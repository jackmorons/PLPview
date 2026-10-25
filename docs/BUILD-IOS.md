# Build and run on iPhone

From a clean Mac to the app on your phone. You need a Mac, a USB cable, and a free Apple ID.

## 1. One-time setup

1. **Install Node.js 24 LTS** from nodejs.org (or `brew install node@24`). Check with `node -v`: anything from v22.12 works.
2. **Xcode**: you have it. Update it to the latest version from the App Store; Capacitor 8 needs a recent Xcode.
   Open it once and let it install its components.
3. **Clone the project and install its packages:**
   ```sh
   git clone https://github.com/jackmorons/plpview.git
   cd plpview
   npm install          # downloads every package listed in package.json into node_modules/
   ```
   `npm install` is required before Xcode. The iOS project loads the plugins' native code from `node_modules/`.
4. **Check the setup:** `npx cap doctor` reports the Capacitor versions and anything missing.
5. **Prepare your iPhone:**
   - Connect it with the cable and tap **Trust this computer**.
   - Turn on Developer Mode: *Settings → Privacy & Security → Developer Mode*. The phone restarts.
     (The option only appears after Xcode has seen the phone once; if it's missing, do step 3 of the next section first.)

## 2. Build and run

```sh
npm run build        # Vite bundles src/ into dist/
npx cap sync         # copies dist/ and the plugins into ios/
npm run ios          # opens ios/App/App.xcodeproj in Xcode
```

In Xcode:

1. Click **App** in the left panel (blue icon) → target **App** → **Signing & Capabilities**.
2. Tick **Automatically manage signing**. Under **Team** choose **Add an Account…**, sign in with your Apple ID,
   then pick *Your Name (Personal Team)*.
3. At the top, choose your iPhone as the run destination (not a simulator).
4. Press **▶ Run**. The first build downloads Capacitor's Swift packages and takes a few minutes.
5. The first time, the phone refuses to open the app. On the phone:
   *Settings → General → VPN & Device Management → your Apple ID → Trust*. Then tap the app.

You should see **PL** and *Piattaforma: ios*.

## 3. The edit loop

1. `npm run dev`: edit in the browser at the address it prints. Most work happens here.
2. `npm run build && npx cap sync`: when you want it on the phone.
3. **▶ Run** in Xcode.

## 4. The 7-day limit

Apps signed with a free Personal Team stop opening after **7 days**. Plug in the phone and press ▶ Run again
to renew. Your data survives as long as you **don't delete the app** first. A free account can have at most
3 such apps on a phone at a time.

## 5. Common problems

| Symptom | Fix |
|---|---|
| *"Signing for 'App' requires a development team"* | Step 2.1–2.2: choose your Personal Team. |
| *"Failed to register bundle identifier"* / *"not available"* | The id is taken on Apple's side. Change it **everywhere**: `capacitor.config.json` and Xcode's Bundle Identifier, then `npx cap sync`. Do this before you have data in the app. |
| Xcode can't resolve packages / *"Missing package product 'CapApp-SPM'"* | You skipped `npm install`, or ran it before switching branch. Run `npm install && npx cap sync`, then *File → Packages → Reset Package Caches*. |
| The phone shows an old version | You skipped `npm run build && npx cap sync`. Both, every time, before ▶ Run. |
| *"Untrusted Developer"* on the phone | Step 2.5. |
| Phone not in the destination list | Unlock it, re-plug, accept *Trust*, and check Developer Mode is on. |
