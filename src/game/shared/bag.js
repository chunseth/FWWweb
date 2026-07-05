export const BLANK_LETTER = " ";

export const TILE_DISTRIBUTION = {
  [BLANK_LETTER]: { count: 2, value: 0 },
  A: { count: 9, value: 1 },
  B: { count: 2, value: 3 },
  C: { count: 2, value: 3 },
  D: { count: 4, value: 2 },
  E: { count: 12, value: 1 },
  F: { count: 2, value: 4 },
  G: { count: 3, value: 2 },
  H: { count: 2, value: 4 },
  I: { count: 9, value: 1 },
  J: { count: 1, value: 8 },
  K: { count: 1, value: 5 },
  L: { count: 4, value: 1 },
  M: { count: 2, value: 3 },
  N: { count: 6, value: 1 },
  O: { count: 8, value: 1 },
  P: { count: 2, value: 3 },
  Q: { count: 1, value: 10 },
  R: { count: 6, value: 1 },
  S: { count: 4, value: 1 },
  T: { count: 6, value: 1 },
  U: { count: 4, value: 1 },
  V: { count: 2, value: 4 },
  W: { count: 2, value: 4 },
  X: { count: 1, value: 8 },
  Y: { count: 2, value: 4 },
  Z: { count: 1, value: 10 },
};

export const MINI_TILE_DISTRIBUTION = {
  [BLANK_LETTER]: { count: 1, value: 0 },
  A: { count: 3, value: 1 },
  B: { count: 1, value: 3 },
  C: { count: 1, value: 3 },
  D: { count: 2, value: 2 },
  E: { count: 5, value: 1 },
  F: { count: 1, value: 4 },
  G: { count: 1, value: 2 },
  H: { count: 1, value: 4 },
  I: { count: 3, value: 1 },
  J: { count: 0, value: 8 },
  K: { count: 1, value: 5 },
  L: { count: 2, value: 1 },
  M: { count: 1, value: 3 },
  N: { count: 3, value: 1 },
  O: { count: 5, value: 1 },
  P: { count: 1, value: 3 },
  Q: { count: 0, value: 10 },
  R: { count: 3, value: 1 },
  S: { count: 3, value: 1 },
  T: { count: 3, value: 1 },
  U: { count: 2, value: 1 },
  V: { count: 1, value: 4 },
  W: { count: 1, value: 4 },
  X: { count: 0, value: 8 },
  Y: { count: 1, value: 4 },
  Z: { count: 0, value: 10 },
};

export const hashSeed = (seed) => {
  // FNV-1a with an extra avalanche step so adjacent seeds do not map to
  // nearly-adjacent RNG states.
  let hash = 0x811c9dc5;

  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
};

export const createSeededRandom = (seed, initialState = null) => {
  let state =
    typeof initialState === "number" && Number.isFinite(initialState)
      ? initialState
      : hashSeed(seed);

  return {
    next: () => {
      state = (state * 1664525 + 1013904223) % Math.pow(2, 32);
      return state / Math.pow(2, 32);
    },
    getState: () => state,
  };
};

export const shuffleArray = (array, randomFn) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const initializeTileBag = () => {
  const tileBag = [];
  for (const [letter, data] of Object.entries(TILE_DISTRIBUTION)) {
    for (let i = 0; i < data.count; i += 1) {
      tileBag.push({ letter, value: data.value });
    }
  }
  return tileBag;
};

export const initializeMiniTileBag = (seed = "") => {
  const distribution = Object.fromEntries(
    Object.entries(MINI_TILE_DISTRIBUTION).map(([letter, data]) => [
      letter,
      { ...data },
    ])
  );
  const random = createSeededRandom(`${String(seed)}:mini-distribution`);

  const includeQ = random.next() < 0.5;
  distribution.Q.count = includeQ ? 1 : 0;
  distribution.Z.count = includeQ ? 0 : 1;

  const includeJ = random.next() < 0.5;
  distribution.J.count = includeJ ? 1 : 0;
  distribution.X.count = includeJ ? 0 : 1;

  // Q-heavy seeds get one extra U and one fewer V or W to keep total stable.
  if (includeQ) {
    distribution.U.count = 3;
    const removeV = random.next() < 0.5;
    if (removeV) {
      distribution.V.count = Math.max(0, distribution.V.count - 1);
    } else {
      distribution.W.count = Math.max(0, distribution.W.count - 1);
    }
  }

  const tileBag = [];
  for (const [letter, data] of Object.entries(distribution)) {
    for (let i = 0; i < data.count; i += 1) {
      tileBag.push({ letter, value: data.value });
    }
  }
  return tileBag;
};

export const createShuffledTileBag = (seed, initialState = null) => {
  const random = createSeededRandom(seed, initialState);
  return {
    random,
    tileBag: shuffleArray(initializeTileBag(), random.next),
  };
};

export const drawTilesFromBag = (
  tileBag,
  count,
  nextTileId = 0,
  ownerId = null
) => {
  const nextBag = [...tileBag];
  const drawnTiles = [];
  let nextId = nextTileId;

  for (let i = 0; i < count && nextBag.length > 0; i += 1) {
    const tile = nextBag.pop();
    drawnTiles.push({
      ...tile,
      id: ownerId ? `${ownerId}-${nextId}` : nextId,
    });
    nextId += 1;
  }

  return {
    drawnTiles,
    nextBag,
    nextTileId: nextId,
  };
};
