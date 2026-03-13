// Closure tests

// Simple arrow function with no captures
let add = (a: number, b: number): number => a + b;
console.log(add(3, 4));  // 7

// Arrow with capture
let multiplier: number = 5;
let multiply = (x: number): number => x * multiplier;
console.log(multiply(6));  // 30

// Arrow with block body
let greet = (x: number): number => {
  let result: number = x + 100;
  return result;
};
console.log(greet(42));  // 142

// Multiple captures
let a: number = 10;
let b: number = 20;
let sumAB = (): number => a + b;
console.log(sumAB());  // 30

// Closure passed as callback
function applyTwice(fn: any, x: number): number {
  return fn(fn(x));
}
let addTen = (x: number): number => x + 10;
console.log(applyTwice(addTen, 5));  // 25

// Higher-order function returning closure
function makeAdder(n: number): any {
  return (x: number): number => x + n;
}
let add5 = makeAdder(5);
console.log(add5(10));  // 15
console.log(add5(20));  // 25
