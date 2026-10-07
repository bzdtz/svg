interface PathSegment {
  command: string;
  values: number[];
}

const PARAM_COUNTS: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

const TOKEN_RE = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;

function isCommand(token: string): boolean {
  return /^[a-zA-Z]$/.test(token);
}

function paramCount(command: string): number {
  return PARAM_COUNTS[command.toUpperCase()] ?? -1;
}

function nextImplicitCommand(command: string): string {
  if (command === "M") return "L";
  if (command === "m") return "l";
  return command;
}

function parsePathData(d: string): PathSegment[] | null {
  const tokens = d.match(TOKEN_RE);
  if (!tokens) return null;

  const segments: PathSegment[] = [];
  let index = 0;
  let command = "";

  while (index < tokens.length) {
    const token = tokens[index];
    if (isCommand(token)) {
      command = token;
      index += 1;
    } else if (!command) {
      return null;
    }

    const count = paramCount(command);
    if (count < 0) return null;

    if (count === 0) {
      segments.push({ command, values: [] });
      command = nextImplicitCommand(command);
      if (index < tokens.length && !isCommand(tokens[index])) return null;
      continue;
    }

    while (index < tokens.length && !isCommand(tokens[index])) {
      if (index + count > tokens.length) return null;
      const values = tokens.slice(index, index + count).map(Number);
      if (values.some((value) => !Number.isFinite(value))) return null;
      segments.push({ command, values });
      index += count;
      command = nextImplicitCommand(command);
    }
  }

  return segments;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function serializePathData(segments: PathSegment[]): string {
  return segments
    .map((segment) => {
      if (!segment.values.length) return segment.command;
      return `${segment.command}${segment.values.map(formatNumber).join(" ")}`;
    })
    .join(" ");
}

function adjustPairs(values: number[], pairs: number[], adjust: (value: number, axis: "x" | "y") => number): void {
  pairs.forEach((start) => {
    values[start] = adjust(values[start], "x");
    values[start + 1] = adjust(values[start + 1], "y");
  });
}

export function translatePathData(d: string, dx: number, dy: number): string | null {
  const segments = parsePathData(d);
  if (!segments) return null;

  let firstSegment = true;
  segments.forEach((segment) => {
    const command = segment.command;
    const upper = command.toUpperCase();
    const isAbsolute = command === upper;
    const values = segment.values;

    const translateAbs = (value: number, axis: "x" | "y") => value + (axis === "x" ? dx : dy);

    if (isAbsolute) {
      if (upper === "M" || upper === "L" || upper === "T") adjustPairs(values, [0], translateAbs);
      if (upper === "H") values[0] += dx;
      if (upper === "V") values[0] += dy;
      if (upper === "C") adjustPairs(values, [0, 2, 4], translateAbs);
      if (upper === "S" || upper === "Q") adjustPairs(values, [0, 2], translateAbs);
      if (upper === "A") adjustPairs(values, [5], translateAbs);
    } else if (firstSegment && upper === "M") {
      adjustPairs(values, [0], translateAbs);
    }

    firstSegment = false;
  });

  return serializePathData(segments);
}

export function scalePathData(d: string, cx: number, cy: number, factor: number): string | null {
  const segments = parsePathData(d);
  if (!segments || !Number.isFinite(factor) || factor <= 0) return null;

  let firstSegment = true;
  segments.forEach((segment) => {
    const command = segment.command;
    const upper = command.toUpperCase();
    const isAbsolute = command === upper;
    const values = segment.values;
    const scaleAbs = (value: number, axis: "x" | "y") => {
      const center = axis === "x" ? cx : cy;
      return center + (value - center) * factor;
    };
    const scaleRel = (value: number) => value * factor;

    if (isAbsolute) {
      if (upper === "M" || upper === "L" || upper === "T") adjustPairs(values, [0], scaleAbs);
      if (upper === "H") values[0] = scaleAbs(values[0], "x");
      if (upper === "V") values[0] = scaleAbs(values[0], "y");
      if (upper === "C") adjustPairs(values, [0, 2, 4], scaleAbs);
      if (upper === "S" || upper === "Q") adjustPairs(values, [0, 2], scaleAbs);
      if (upper === "A") {
        values[0] = scaleRel(values[0]);
        values[1] = scaleRel(values[1]);
        adjustPairs(values, [5], scaleAbs);
      }
    } else {
      if (firstSegment && upper === "M") adjustPairs(values, [0], scaleAbs);
      else {
        if (upper === "M" || upper === "L" || upper === "T") adjustPairs(values, [0], (value) => scaleRel(value));
        if (upper === "H" || upper === "V") values[0] = scaleRel(values[0]);
        if (upper === "C") adjustPairs(values, [0, 2, 4], (value) => scaleRel(value));
        if (upper === "S" || upper === "Q") adjustPairs(values, [0, 2], (value) => scaleRel(value));
        if (upper === "A") {
          values[0] = scaleRel(values[0]);
          values[1] = scaleRel(values[1]);
          adjustPairs(values, [5], (value) => scaleRel(value));
        }
      }
    }

    firstSegment = false;
  });

  return serializePathData(segments);
}
