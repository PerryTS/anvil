// Enum tests

const enum Color {
  Red = 0,
  Green = 1,
  Blue = 2,
}

console.log(Color.Red);    // 0
console.log(Color.Green);  // 1
console.log(Color.Blue);   // 2

// Auto-incrementing
const enum Direction {
  Up,
  Down,
  Left,
  Right,
}

console.log(Direction.Up);     // 0
console.log(Direction.Down);   // 1
console.log(Direction.Left);   // 2
console.log(Direction.Right);  // 3

// Custom start value
const enum Status {
  Pending = 10,
  Active,
  Closed,
}

console.log(Status.Pending);  // 10
console.log(Status.Active);   // 11
console.log(Status.Closed);   // 12

// Use in switch-like if/else
function colorName(c: number): number {
  if (c === Color.Red) {
    return 1;
  }
  if (c === Color.Green) {
    return 2;
  }
  if (c === Color.Blue) {
    return 3;
  }
  return 0;
}

console.log(colorName(0));  // 1 (Red)
console.log(colorName(1));  // 2 (Green)
console.log(colorName(2));  // 3 (Blue)
console.log(colorName(9));  // 0 (unknown)
