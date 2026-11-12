// What's new: shown once, the first time a newer version is opened (not on a
// brand-new install). Newest entry first. For each release, add an entry at
// the top with the next id (see docs/RELEASING.md).
export const WHATS_NEW = [
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
