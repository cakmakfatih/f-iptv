/** Leaves the app on Hisense, Tizen, webOS, Android TV wrappers or a plain browser. */
export function exitApp(): void {
  window.dispatchEvent(new CustomEvent('app:exit'));
  const w = window as any;
  const attempts: Array<() => void> = [
    () => typeof w.Hisense_ExitApp === 'function' && w.Hisense_ExitApp(),
    () => typeof w.tizen?.application?.getCurrentApplication === 'function' && w.tizen.application.getCurrentApplication().exit(),
    () => typeof w.webapis?.application?.exit === 'function' && w.webapis.application.exit(),
    () => typeof w.webOS?.platformBack === 'function' && w.webOS.platformBack(),
    () => typeof (navigator as any).app?.exitApp === 'function' && (navigator as any).app.exitApp(),
    () => window.close(),
  ];
  for (const attempt of attempts) {
    try {
      attempt();
    } catch {
      // try the next platform
    }
  }
}

/** Running on a TV browser (no physical keyboard; <input> focus pops the TV's own keyboard). */
export function isTvDevice(): boolean {
  return /VIDAA|Hisense|Web0S|webOS|Tizen|SMART-TV|SmartTV|Android TV|AFT|BRAVIA|NetCast|Philips|Roku|CrKey/i.test(navigator.userAgent);
}
