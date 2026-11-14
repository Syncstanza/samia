**Sami'a 1.6.0**: Quran karaoke for masjids, schools and friends. Recite, and the words light up on the big screen as you reach them. Free, and works offline.

## 🆕 New in 1.6

- 📖 **Page view.** In free recite, tap **Page** to see the real Madinah mushaf page, line for line (15 lines). Recited words light up, the word you are on glows, and the page turns by itself. Odd pages are on the right, even pages on the left, with the first two words of the next page at the corner.
- 📱 **Android: portrait for the page view.** The phone turns upright so the lines are big enough to read; every other screen stays landscape.
- 🧠 **Hifz test waits for A'udhu billah and Bismillah** to finish before it starts looking for your place.
- 🕋 **Slow-recitation reminder.** The opening screen shows Al-Muzzammil 73:4 with its translation.

> Page layout and font: King Fahd Complex, via quran.ws/text (CC BY 4.0).

## Earlier: 1.5.7

- 🎙 **Free recite waits for the opening.** The A'udhu billah / Bismillah screen now stays until you have finished Bismillah, instead of disappearing while you are still saying it.

## Earlier: 1.5.6

- 🎙 **Free recite starts with A'udhu billah and Bismillah**, like every turn: Sami'a hears you right away and finds your place faster.
- 📖 **A reminder to recite slowly.** The opening screen shows Al-Muzzammil 73:4 with its translation, in free recite and the hifz test.

## Earlier: 1.5.5

- 🔀 **Smoother surah changes.** With or without Bismillah, the new surah is found faster and a wrong one no longer flashes up first.
- 📱 **Slow phones keep up.** The glowing letters stay with you; Settings shows the listening speed.
- 🕌 **Bismillah no longer confuses the search.**

## Earlier: 1.5.4

- 🔀 **Switching surahs is found much faster.** Finish one surah and start another (say al-Mulk, then al-Asr) and Sami'a now notices within the first ayah instead of waiting or missing it.

## Earlier: 1.5.3

- ⚡ **Finds your place faster.** Short surahs like al-Kawthar are now found during the first ayah instead of the last.

## Earlier: 1.5.2

- 📱 **Android: no more dark bars.** Pulling down the status bar used to push the app aside; now it slides over the app.

## Earlier: 1.5.1

- ✨ The intro now says **by Syncstanza** under the name.
- 📱 **Android update fix.** Updating opens the download in your phone's browser, so you get the normal *Open* button to install it. The in-app page used to get stuck on "Downloading".

## Earlier: 1.5

- 🌐 **Web version.** Open Sami'a in any browser, or set it up as a kiosk app on Chromebooks: https://syncstanza.github.io/samia/ . Always the latest version, and it works offline after the first visit.
- 🎙 **Every turn starts with A'udhu billah and Bismillah.** The turn begins once Sami'a hears you, so you know the microphone works (a "Start anyway" button is there if it doesn't pick it up).
- 🎯 The reciter's name is centred on the turn screen.

## Earlier: 1.4


- 📱 **Android.** Sami'a now runs on Android phones and tablets (Android 7 or newer): same speech engine, same screens, in landscape. Open this page on the phone, tap `Samia-1.4.0.apk`, and allow installs from your browser when asked. Updates open the new download for you to tap.
- ✨ **The intro plays on every PC**, including ones where Windows has animation effects turned off.

## Earlier: 1.3.1

- 🛠 **Intro fix.** The intro could stay stuck on its first frame while the app was still loading. It now starts straight away.

## Earlier: 1.3

- ✨ **A new intro.** The logo draws itself, the name appears, then everything glides into the home screen as the three modes rise in. Any key or click skips it, and Settings → *Play the intro when the app opens* turns it off.

## Earlier: 1.2

- 🖥 **Full-screen button works.** It opens in a window; the button (or **F**) toggles full screen. For a dedicated display PC, `npm run start:kiosk` starts full screen.
- 🧪 Test builds keep their own settings.

> On 1.1 or later? The app offers the update by itself.

## Earlier: 1.1

- 🧠 **Hifz test → Recite anywhere.** No passage to pick: start from any ayah, the words appear only once you say them, and the score covers exactly what you recited.
- 🎯 **Follows like a person reading along.** It expects the next ayah and moves as soon as its first words are heard, so the screen no longer lags at the start of each ayah. Once it has found the surah, it stays in it.
- 🔁 **Repeated words fixed.** Words that appear twice in an ayah (like the two عليهم in al-Fatiha) no longer make it jump ahead.
- ⚡ **Free recite finds you faster:** usually within 4–5 seconds, showing the words it hears while it looks.
- 🔄 **Updates in one click.** From this version on, *Update available* appears on the home screen when a new version is out. Settings shows the version, *Check for updates* and *What's new*.
- 📣 **Announcements:** news and tips in a small bar on the home screen (can be turned off).
- 💾 **Settings are kept between starts** (microphone, names, last passage).

> Coming from 1.0? Download 1.1 once by hand from the files below. After that, updates install from inside the app.

## ✨ All modes

| Mode | What it does |
|---|---|
| 🎤 **Free recite** | Start anywhere in the Quran. Sami'a finds the ayah (usually within a few seconds) and follows you word by word. |
| 🕌 **School / Masjid competition** | For judged events. Each reciter takes a turn while the audience follows the ayat on screen. No scores shown: the judges decide. |
| 🏆 **Friends competition** | Take turns on a passage. Sami'a scores everyone and ranks them on a scoreboard. |
| 🧠 **Hifz test** | The text stays hidden and appears only as you recite it. Pick a passage or recite from anywhere. Scored at the end. |

Scores mark every word: ✅ correct, 🟡 check, ❌ skipped, ⚪ not reached.

## ⬇️ Which file do I download?

| You have | Download |
|---|---|
| Windows 10 / 11 (install it) | `Samia-Setup-1.1.0.exe` |
| Windows, no install (USB stick, school PC) | `Samia-1.1.0.exe` |
| Linux | `Samia-1.1.0.AppImage`, then `chmod +x` it and run (add `--no-sandbox` on newer Ubuntu/Mint if it won't start) |

Windows may show "Windows protected your PC" because the app isn't signed yet: click **More info → Run anyway**.

## ⌨️ Keys

<kbd>Space</kbd> start a turn · <kbd>Enter</kbd> done · <kbd>H</kbd> home · <kbd>S</kbd> settings (microphone) · <kbd>←</kbd>/<kbd>→</kbd> move by hand · <kbd>M</kbd> mute · <kbd>B</kbd> blank · <kbd>F</kbd> full screen

## 🔒 Privacy

No account, nothing recorded. The app only goes online to check for updates and announcements; nothing about you or your recitation is sent.

Quran text: Tanzil.net · Translation: Saheeh International · Font: Amiri Quran
