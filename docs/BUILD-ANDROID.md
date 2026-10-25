# Build and run on Android

From a clean machine (Mac, Windows or Linux) to the app on an Android phone. No Play Store account needed.

## 1. One-time setup

1. **Install Node.js 24 LTS** from nodejs.org. Check with `node -v`: anything from v22.12 works.
2. **Install Android Studio** (latest stable) from developer.android.com. It includes the JDK and the Android SDK.
   On first launch run the setup wizard with the defaults.
3. **Android SDK**: the project targets Android 16 (API 36). In Android Studio, *Settings → Languages & Frameworks →
   Android SDK*: tick **Android 16 (API 36)** under *SDK Platforms* if it isn't installed. The app runs on
   Android 7 (API 24) and newer.
4. **Clone the project and install its packages:**
   ```sh
   git clone https://github.com/jackmorons/plpview.git
   cd plpview
   npm install          # downloads every package listed in package.json into node_modules/
   ```
5. **Check the setup:** `npx cap doctor`.
6. **Prepare the phone:**
   - *Settings → About phone →* tap **Build number** 7 times. "Developer options" appears.
   - *Settings → System → Developer options →* turn on **USB debugging**.
   - Connect the cable, and on the phone accept **Allow USB debugging?** for this computer.

## 2. Build and run

```sh
npm run build        # Vite bundles src/ into dist/
npx cap sync         # copies dist/ and the plugins into android/
npm run android      # opens android/ in Android Studio
```

In Android Studio:
1. Wait for **Gradle sync** to finish (bottom bar). The first time it downloads a lot and takes several minutes.
2. Choose your phone in the device menu at the top.
3. Press **▶ Run**.

You should see **PL** and *Piattaforma: android*.

## 3. Installing without a cable: a debug APK

```sh
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
```
The file is `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the phone (Drive, email, cable),
open it, and allow **Install unknown apps** for the app you opened it from when Android asks.
Installing a newer APK over the old one keeps the app's data.

**About sideloading rules.** Google is phasing in developer verification for apps installed outside the Play Store:
from 30 September 2026 in Brazil, Indonesia, Singapore and Thailand, worldwide from 2027.
Installing over `adb` (what ▶ Run does) stays allowed, and a free "limited distribution" account covers
up to 20 devices. Today, in Italy, nothing changes; check again in 2027.

## 4. The edit loop

1. `npm run dev`: edit in the browser.
2. `npm run build && npx cap sync`: when you want it on the phone.
3. **▶ Run** in Android Studio.

## 5. Common problems

| Symptom | Fix |
|---|---|
| Phone not in the device list | USB debugging on? Accepted the prompt on the phone? Try another cable (some only charge) and set the USB mode to *File transfer*. |
| Gradle error about the Java/JDK version | The project needs JDK 21. *Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK*: choose the bundled **jbr-21**. |
| *"SDK location not found"* / missing platform 36 | Install Android 16 (API 36) in the SDK Manager (setup step 3), then *File → Sync Project with Gradle Files*. |
| The phone shows an old version | You skipped `npm run build && npx cap sync`. Both, every time, before ▶ Run. |
| *"App not installed"* when opening an APK | An app with the same id but a different signature is installed (e.g. built on another computer). Uninstall it first; that deletes its data, so export a backup before. |
