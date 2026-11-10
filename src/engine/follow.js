// One step of following the imam: speech -> verse tracker -> prayer position.
// Used by the app's worker, the simulator and the tests, so all three behave
// the same way.
//
// Two phases:
//   RECITATION  the imam is standing and reciting: the verse tracker leads.
//   MOVEMENT    ruku' and sujood (from the ruku' takbir until recitation
//               clearly starts again): the ayah on SCREEN is frozen, so
//               nothing heard here (tasbih, takbirs, a cough, the
//               congregation) can move it. The verse tracker keeps listening
//               underneath, so it can find al-Fatiha or the khatm again even
//               if a takbir was missed and the positions got out of step.

export function followHop(tracker, salah, { text = '', newFraction = 1, dt = 0.6, utter = null, push = false } = {}) {
  const res = push ? tracker.push(text) : tracker.observe(text, newFraction);
  const view = salah.step(res, dt, utter);

  if (view.position !== 'QIYAM') {
    // Freeze what the screen shows at the moment the movement phase began.
    if (!salah.frozen) salah.frozen = { ayah: res.ayah, letter: res.letter };
    return { ...res, ayah: salah.frozen.ayah, letter: salah.frozen.letter, changed: false, salah: view, phase: 'MOVEMENT' };
  }
  const resumed = !!salah.frozen;
  salah.frozen = null;
  // Back to standing: show where the tracker is now.
  return { ...res, changed: res.changed || resumed, salah: view, phase: 'RECITATION' };
}
