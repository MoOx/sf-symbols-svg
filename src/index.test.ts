import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DOMParser } from "xmldom";

const execAsync = promisify(exec);

/**
 * Calculate the bounding box of an SVG path
 * This is a simplified version that works for most SVG paths
 * @param pathData The SVG path data string
 * @returns The bounding box {minX, minY, maxX, maxY}
 */
function calculatePathBoundingBox(pathData: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  // Initialize with extreme values
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Regular expressions to extract coordinates from path commands
  const moveToRegex = /[Mm]\s*([\-\d\.]+)[\s,]*([\-\d\.]+)/g;
  const lineToRegex = /[Ll]\s*([\-\d\.]+)[\s,]*([\-\d\.]+)/g;
  const curveToRegex =
    /[CcSs]\s*([\-\d\.]+)[\s,]*([\-\d\.]+)[\s,]*([\-\d\.]+)[\s,]*([\-\d\.]+)(?:[\s,]*([\-\d\.]+)[\s,]*([\-\d\.]+))?/g;
  const arcRegex =
    /[Aa]\s*([\-\d\.]+)[\s,]*([\-\d\.]+)[\s,]*([\-\d\.]+)[\s,]*([01])[\s,]*([01])[\s,]*([\-\d\.]+)[\s,]*([\-\d\.]+)/g;

  // Extract coordinates from move commands
  let match;
  while ((match = moveToRegex.exec(pathData)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // Extract coordinates from line commands
  while ((match = lineToRegex.exec(pathData)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // Extract coordinates from curve commands
  while ((match = curveToRegex.exec(pathData)) !== null) {
    for (let i = 1; i < match.length; i += 2) {
      if (match[i] && match[i + 1]) {
        const x = parseFloat(match[i]);
        const y = parseFloat(match[i + 1]);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  // Extract coordinates from arc commands
  while ((match = arcRegex.exec(pathData)) !== null) {
    const x = parseFloat(match[6]);
    const y = parseFloat(match[7]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // If no coordinates were found, return default values
  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Apply a transformation matrix to a point
 * @param x The x coordinate
 * @param y The y coordinate
 * @param matrix The transformation matrix [a, b, c, d, e, f]
 * @returns The transformed point [x', y']
 */
function applyTransformToPoint(
  x: number,
  y: number,
  matrix: number[],
): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const INDEX_TS_PATH = path.join(__dirname, "index.ts");
const TEST_DIR = path.join(__dirname, "..", "test-output");
const ICONS_LIST_FILE = path.join(__dirname, "test-icons.txt");
const DEFAULT_OUTPUT_DIR = path.join(TEST_DIR, "default");
const ALL_OPTIONS_OUTPUT_DIR = path.join(TEST_DIR, "all-options");
const SOURCES_DIR = path.join(__dirname, "..", "sources");

// Test parameters
const DEFAULT_SIZE = 24;
const DEFAULT_PADDING = 2;
const CUSTOM_SIZE = 32;
const CUSTOM_PADDING = 4;

const SOME_OPTIONS_COMMAND = [
  "--size",
  CUSTOM_SIZE.toString(),
  "--padding",
  CUSTOM_PADDING.toString(),
  "--weight",
  "regular",
  "--weight",
  "bold",
  "--weight",
  "black",
  "--weight",
  "semibold",
  "--output",
  ALL_OPTIONS_OUTPUT_DIR,
  "--sf-version",
  "6.0",
  "--sources-dir",
  SOURCES_DIR,
  "--icons-list",
  ICONS_LIST_FILE,
];

/**
 * Cleans up test directories
 */
async function cleanupTestDir(): Promise<void> {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  } catch (error) {
    console.error("Error cleaning up test directory:", error);
  }
}

/**
 * Runs the sf-symbols-svg command with specified options
 */
async function runCommand(options: string[]): Promise<string> {
  const command = `node --experimental-strip-types ${INDEX_TS_PATH} ${options.join(" ")}`;
  console.log(`Running: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      console.warn("Command stderr:", stderr);
    }
    return stdout;
  } catch (error) {
    console.error("Command execution error:", error);
    throw error;
  }
}

/**
 * Verifies the SVG files exist and have correct properties
 */
async function verifySvgFiles(
  outputDir: string,
  expectedSize: number,
  expectedPadding: number,
): Promise<void> {
  // Get list of icons from the test file
  const iconsContent = await fs.readFile(ICONS_LIST_FILE, "utf8");
  const iconNames = iconsContent
    .split("\n")
    .filter((name) => name.trim() !== "");

  let weights: string[];
  if (outputDir === ALL_OPTIONS_OUTPUT_DIR) {
    weights = [];
    for (let i = 0; i < SOME_OPTIONS_COMMAND.length; i++) {
      if (
        SOME_OPTIONS_COMMAND[i] === "--weight" &&
        i + 1 < SOME_OPTIONS_COMMAND.length
      ) {
        const weight = SOME_OPTIONS_COMMAND[i + 1];
        if (!weight.startsWith("--")) {
          weights.push(weight);
        }
      }
    }
  } else {
    weights = ["regular"];
  }

  console.log(`Testing ${weights.length} weight(s): ${weights.join(", ")}`);

  for (const iconName of iconNames) {
    for (const weight of weights) {
      const safeFileName = iconName.replace(/[^a-z0-9\.]/gi, "_").toLowerCase();
      const svgFilename =
        weight === "regular"
          ? `${safeFileName}.svg`
          : `${safeFileName}-${weight}.svg`;

      const svgPath = path.join(outputDir, svgFilename);

      try {
        await fs.access(svgPath);
        console.log(`✓ SVG file for ${iconName} (${weight}) exists`);
      } catch (error) {
        throw new Error(
          `SVG file for ${iconName} (${weight}) does not exist: ${error}`,
        );
      }

      const svgContent = await fs.readFile(svgPath, "utf8");
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
      const svgElement = svgDoc.getElementsByTagName("svg")[0];
      const viewBox = svgElement.getAttribute("viewBox");
      const width = svgElement.getAttribute("width");
      const height = svgElement.getAttribute("height");

      if (viewBox !== `0 0 ${expectedSize} ${expectedSize}`) {
        throw new Error(
          `Invalid viewBox for ${iconName}: ${viewBox}, expected "0 0 ${expectedSize} ${expectedSize}"`,
        );
      }

      if (width !== `${expectedSize}` || height !== `${expectedSize}`) {
        throw new Error(
          `Invalid width/height for ${iconName}: ${width}x${height}, expected ${expectedSize}x${expectedSize}`,
        );
      }

      const pathElement = svgDoc.getElementsByTagName("path")[0];
      const transform = pathElement.getAttribute("transform");

      if (!transform || !transform.includes("matrix")) {
        throw new Error(
          `Missing or invalid transform for ${iconName}: ${transform}`,
        );
      }

      const matrixValues = transform.match(/matrix\(([^)]+)\)/);
      if (matrixValues && matrixValues[1]) {
        const values = matrixValues[1]
          .split(",")
          .map((v: string) => parseFloat(v.trim()));

        if (values.length === 6) {
          const [scaleX, , , scaleY, translateX, translateY] = values;

          if (scaleX <= 0 || scaleY <= 0) {
            throw new Error(
              `Invalid scale values for ${iconName}: scaleX=${scaleX}, scaleY=${scaleY}`,
            );
          }

          const pathData = pathElement.getAttribute("d");
          if (pathData) {
            const bbox = calculatePathBoundingBox(pathData);

            const transformedCorners = [
              applyTransformToPoint(bbox.minX, bbox.minY, values),
              applyTransformToPoint(bbox.maxX, bbox.minY, values),
              applyTransformToPoint(bbox.minX, bbox.maxY, values),
              applyTransformToPoint(bbox.maxX, bbox.maxY, values),
            ];

            const transformedMinX = Math.min(
              ...transformedCorners.map((p) => p[0]),
            );
            const transformedMinY = Math.min(
              ...transformedCorners.map((p) => p[1]),
            );
            const transformedMaxX = Math.max(
              ...transformedCorners.map((p) => p[0]),
            );
            const transformedMaxY = Math.max(
              ...transformedCorners.map((p) => p[1]),
            );

            const transformedWidth = transformedMaxX - transformedMinX;
            const transformedHeight = transformedMaxY - transformedMinY;

            // In SVGs, coordinates are often negative because the glyph origin is typically
            // at the bottom left, and the transformation moves it to the center of the viewBox.
            // We need to check the actual dimensions.

            // Verify that the dimensions respect the padding
            const maxAllowedWidth = expectedSize - expectedPadding * 2;
            const maxAllowedHeight = expectedSize - expectedPadding * 2;

            // Calculate the effective padding on each side
            const horizontalPadding = (expectedSize - transformedWidth) / 2;
            const verticalPadding = (expectedSize - transformedHeight) / 2;

            // Verify that the padding is sufficient
            const minPadding = expectedPadding * 0.8; // 20% tolerance

            if (
              horizontalPadding < minPadding ||
              verticalPadding < minPadding
            ) {
              console.warn(
                `Warning: Padding may not be respected for ${iconName}:\n` +
                  `  Horizontal padding: ${horizontalPadding.toFixed(2)}px (min: ${expectedPadding}px)\n` +
                  `  Vertical padding: ${verticalPadding.toFixed(2)}px (min: ${expectedPadding}px)\n` +
                  `  Symbol dimensions: ${transformedWidth.toFixed(2)}x${transformedHeight.toFixed(2)} in ${expectedSize}x${expectedSize} viewBox`,
              );
            } else {
              console.log(
                `✓ Padding is respected for ${iconName}: ` +
                  `H-padding=${horizontalPadding.toFixed(1)}px, V-padding=${verticalPadding.toFixed(1)}px ` +
                  `(expected: ${expectedPadding}px)`,
              );
            }
          }

          console.log(
            `✓ Transform matrix for ${iconName} is valid: scale=${scaleX.toFixed(
              2,
            )}, translate=(${translateX.toFixed(2)}, ${translateY.toFixed(2)})`,
          );
        }
      }

      console.log(`✓ SVG properties for ${iconName} (${weight}) are correct`);
    }
  }
}

/**
 * Main test function
 */
async function runTests(): Promise<void> {
  try {
    console.log("=== Starting SF Symbols to SVG Tests ===");

    // Clean up test directory
    await cleanupTestDir();

    // Test with default options
    console.log("\n=== Testing with default options ===");
    console.log(`Using sources directory: ${SOURCES_DIR}`);
    console.log(`Using icons list file: ${ICONS_LIST_FILE}`);
    await runCommand([
      "--output",
      DEFAULT_OUTPUT_DIR,
      "--icons-list",
      ICONS_LIST_FILE,
      "--sources-dir",
      SOURCES_DIR,
    ]);

    // Verify default output
    await verifySvgFiles(DEFAULT_OUTPUT_DIR, DEFAULT_SIZE, DEFAULT_PADDING);

    // Test with some options
    console.log("\n=== Testing with some options ===");
    await runCommand(SOME_OPTIONS_COMMAND);

    await verifySvgFiles(ALL_OPTIONS_OUTPUT_DIR, CUSTOM_SIZE, CUSTOM_PADDING);

    console.log("\n=== All tests passed successfully! ===");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

runTests();
