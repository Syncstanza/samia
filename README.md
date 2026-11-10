<div align="center">

<img src="docs/logo.png" width="112" alt="Sami'a logo">

# Sami'a

<sub>Made by **Syncstanza**</sub>

**A live Quran display for masjids. Sami'a listens to the imam, follows which ayah is being recited, and shows the Arabic with a translation on the masjid TV. Free, fully offline, made for taraweeh.**

![Status](https://img.shields.io/badge/status-in%20development-f5b82e)
![Target](https://img.shields.io/badge/target-Ramadan%202027-2ee6c5)
![Offline](https://img.shields.io/badge/works-100%25%20offline-7ee36b)
![Windows](https://img.shields.io/badge/Windows-planned-0078d4)
![Linux](https://img.shields.io/badge/Linux-planned-fcc624)
![License](https://img.shields.io/badge/license-Apache--2.0-lightgrey)

</div>

---

> 🚧 **Sami'a is being built for Ramadan 2027.** There is no download yet. This page describes what the first version will do. Features marked *later* are planned after the first release.

---

## ✨ What you get

| | |
|---|---|
| 🎧 **Follows the imam** | Listens to the recitation and works out which surah and ayah is being read, live. |
| 📖 **Arabic + translation** | The current ayah in large Uthmani script, with an English translation underneath. The previous ayah fades out, the next one waits below. |
| ✨ **Lights up word by word** | Each word lights up as the imam reaches it; the word being recited now glows gold. |
| 🔁 **Handles real taraweeh** | Copes with repeated ayat, pauses, al-Fatiha at the start of every rak'ah, takbir and ruku'. When it isn't sure, it stays on the last ayah instead of guessing. |
| 🧎 **Follows the prayer** | After the recitation it shows each position as the imam calls it: ruku', qawmah, sujood, jalsah, the second sujood, then standing for the next rak'ah (or jalsat al-istirahah) or tashahhud and salam. A "الله أكبر" inside an ayah (29:45, 9:72, 40:10) is recognised as recitation, not ruku'. |
| 🤲 **Dua screen** | During dua and qunut the screen goes calm, then picks up again when the recitation returns. |
| 🎛 **Manual override** | Next, previous or blank screen from a USB clicker or a phone remote. One tap puts it right if it ever drifts. |
| 📍 **Start point** | Tell it where tonight begins ("juz 5") and it locks on faster. |
| 📶 **No internet needed** | Speech recognition runs on the computer itself. A bad masjid Wi-Fi network can't stop it. |
| ⚡ **Smooth on the big screen** | The whole Quran is loaded into memory, with 60 fps transitions and no loading pauses. |
| 🔒 **Nothing is recorded** | Audio is processed live and thrown away. Nothing is saved or sent anywhere. |
| 🌍 **More languages** | Bengali, Urdu and more translations come *later*. |
| 📺 **Google TV** | A TV-stick version comes *later*. |

---

## ✅ What you need

| | Minimum | Recommended | Notes |
|---|---|---|---|
| 💻 **Computer** | 64-bit Windows 10 or Linux laptop / mini PC, 4-core CPU, 8 GB RAM | A small mini PC (Intel N100 class) kept behind the TV | It runs the speech model, so a TV stick alone isn't enough for the first version. |
| 📺 **Screen** | Any TV or projector with HDMI | 1080p or 4K TV | |
| 🎙 **Audio** | A microphone near the speaker | **Line-out from the masjid's sound mixer** into a USB audio interface | A direct feed from the mixer is far more accurate than a microphone in an echoey hall. |
| 🎛 **Control** (optional) | A phone on the same network | A USB presenter clicker | The clicker works even with no network at all. |

---

## 🕌 Setting it up at a masjid

*Planned for the first release. A step-by-step volunteer guide with photos will be here.*

1. Connect the computer to the TV with **HDMI**.
2. Connect the mixer's **line out** to the computer's USB audio interface.
3. Turn the computer on. Sami'a starts by itself in full screen.
4. Scan the QR code on the screen to open the phone remote, or plug in the clicker.

That's it. No account, no internet, nothing to log into.

---

## 🛠 How it works

1. **Listen:** audio from the mixer is read in short chunks on the computer.
2. **Recognise:** a speech model trained on Quran recitation turns the audio into Arabic letters.
3. **Match:** those letters are lined up against the Quran text, starting from where the imam was a moment ago, so similar-sounding ayat in other surahs don't confuse it.
4. **Confirm:** it only jumps to a new place when two checks in a row agree. If it's unsure, it holds still.
5. **Show:** the display moves to the ayah with a smooth transition.

---

## 🧪 Try the development version

Needs [Node.js 22+](https://nodejs.org). In the project folder:

```bash
npm install          # app + Electron
npm run model        # downloads the Quran speech model (~19 MB)
npm start            # opens Sami'a full screen and starts listening
```

`npm run start:window` opens it in a normal window. Recite into your microphone and the screen follows.
Move the mouse to show the controls (they hide again after 3 seconds). Keys: <kbd>S</kbd> settings (audio input, tonight's start point), <kbd>→</kbd>/<kbd>←</kbd> move by hand, <kbd>M</kbd> mute, <kbd>D</kbd> dua screen, <kbd>B</kbd> blank, <kbd>Esc</kbd> close.

No microphone handy? `npm run serve`, then open `http://localhost:4173/?demo=2:255-2:257` to watch it follow a simulated recitation.

---

## 🔐 Privacy

No account, no tracking, no internet. Audio never leaves the computer and is never saved. There is nothing to send.

---

## 📜 Credits and license

- **Quran text:** [Tanzil Project](https://tanzil.net), used unmodified.
- **English translation:** Saheeh International, via Tanzil.
- **Arabic font:** Amiri Quran (SIL Open Font License).
- Full details are in [ATTRIBUTION.md](ATTRIBUTION.md).

The app's own code is under the [Apache 2.0 license](LICENSE). The Quran text and translations keep their own terms.

---

<div align="center">

Made by **Syncstanza**, free for every masjid.

</div>
