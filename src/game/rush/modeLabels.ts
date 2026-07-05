export const rushModeShortLabel = (durationSeconds: number): string =>
  durationSeconds === 600 ? "10-Minute Classic" : "5-Minute Mini";

export const newGameLabel = (durationSeconds: number): string =>
  `New Game · ${rushModeShortLabel(durationSeconds)}`;

export const resumeRunLabel = (durationSeconds: number): string =>
  `Resume Run · ${rushModeShortLabel(durationSeconds)}`;
