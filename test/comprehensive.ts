// Comprehensive Phase 2 test
// Tests: variables, arithmetic, functions, control flow, strings, booleans

function fib(n: number): number {
  if (n <= 1) {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

console.log(fib(10));  // 55

function factorial(n: number): number {
  let result: number = 1;
  for (let i: number = 2; i <= n; i = i + 1) {
    result = result * i;
  }
  return result;
}

console.log(factorial(5));   // 120
console.log(factorial(10));  // 3628800

// String test
console.log("hello" + " " + "world");

// Boolean and conditionals
let x: number = 42;
if (x === 42) {
  console.log(1);
} else {
  console.log(0);
}

// Nested function calls
function square(n: number): number {
  return n * n;
}

function sumOfSquares(a: number, b: number): number {
  return square(a) + square(b);
}

console.log(sumOfSquares(3, 4));  // 25

// While with break
let count: number = 0;
while (true) {
  count = count + 1;
  if (count >= 5) {
    break;
  }
}
console.log(count);  // 5
