// What's new: shown once, the first time a newer version is opened (not on a
// brand-new install). Newest entry first. For each release, add an entry at
// the top with the next id (see docs/RELEASING.md).
export const WHATS_NEW = [
  {
    id: 7,
    version: '1.5.0',
    title: 'Sami\'a 1.5',
    items: [
      'Sami\'a now has a web version: open it in a browser, or add it as a kiosk app on Chromebooks. Always the latest version, and it keeps working offline after the first visit.',
      'Every turn now starts with A\'udhu billah and Bismillah. The turn begins once Sami\'a hears you, so you know the microphone is working. There is a "Start anyway" button if it does not pick it up.',
      'The reciter\'s name is now centred at the top of the turn screen.',
    ],
  },
  {
    id: 6,
    version: '1.4.0',
    title: 'Sami\'a 1.4',
    items: [
      'Android: Sami\'a now runs on phones and tablets (Android 7 or newer), in landscape, with the same speech engine and screens. Download the .apk from the release page.',
      'The intro now plays on every PC, including ones where Windows has animation effects turned off.',
    ],
  },
  {
    id: 5,
    version: '1.3.1',
    title: 'Sami\'a 1.3.1',
    items: [
      'Fixed the intro sometimes staying stuck on its first frame while the app was still loading. It now starts straight away.',
    ],
  },
  {
    id: 4,
    version: '1.3.0',
    title: 'Sami\'a 1.3',
    items: [
      'A new intro when the app opens: the logo draws itself, then glides into the home screen as the modes rise in. Any key or click skips it, and Settings can turn it off.',
    ],
  },
  {
    id: 3,
    version: '1.2.0',
    title: 'Sami\'a 1.2',
    items: [
      'The full-screen button works: Sami\'a opens in a window, and the button (or F) switches to full screen and back.',
      'Test builds keep their own settings, so trying one never changes your real setup.',
    ],
  },
  {
    id: 2,
    version: '1.1.0',
    title: 'Sami\'a 1.1',
    items: [
      'Hifz test: "Recite anywhere". No passage to pick: start from any ayah, the words appear only once you say them, and the score covers exactly what you recited.',
      'Follows more like a person reading along: it expects the next ayah and moves as soon as its first words are heard, so the screen no longer lags at the start of each ayah.',
      'Once it has found the surah it stays in it, instead of searching the whole Quran whenever it loses its place for a moment.',
      'Repeated words (like the two عليهم in al-Fatiha) no longer make it jump ahead. It waits until the words in between are actually said.',
      'Free recite finds where you are faster, usually within 4 to 5 seconds, and shows the words it hears while it looks.',
      'Updates: Settings now shows the version, with Check for updates. When a new version is out, "Update available" appears on the home screen and installs in one click.',
      'Announcements: news and tips from Syncstanza can appear in a small bar on the home screen. Settings → Announcements shows them all, and you can turn the bar off.',
      'Your settings (microphone, names, last passage) are now kept between starts.',
    ],
  },
  {
    id: 1,
    version: '1.0.0',
    title: 'Sami\'a 1.0',
    items: [
      'Free recite, School / Masjid and Friends competitions, and the Hifz test.',
    ],
  },
];
