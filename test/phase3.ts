// Phase 3 comprehensive test: arrays, objects, maps

// === Arrays ===

// Create and access
let arr: number[] = [10, 20, 30, 40, 50];
console.log(arr[0]);      // 10
console.log(arr[4]);      // 50
console.log(arr.length);  // 5

// Mutate
arr[2] = 999;
console.log(arr[2]);  // 999

// Push and pop
arr.push(60);
console.log(arr.length);  // 6
console.log(arr[5]);      // 60
let popped: number = arr.pop();
console.log(popped);      // 60
console.log(arr.length);  // 5

// Build array dynamically
let fibs: number[] = [];
fibs.push(0);
fibs.push(1);
for (let i: number = 2; i < 10; i = i + 1) {
  fibs.push(fibs[i - 1] + fibs[i - 2]);
}
// fib(9) = 34
console.log(fibs[9]);  // 34
console.log(fibs.length);  // 10

// Sum elements
function sumArray(a: number[]): number {
  let total: number = 0;
  for (let i: number = 0; i < a.length; i = i + 1) {
    total = total + a[i];
  }
  return total;
}
console.log(sumArray(fibs));  // 0+1+1+2+3+5+8+13+21+34 = 88

// === Objects ===

// Object literal with multiple fields
let person = { name: "alice", age: 30, score: 95 };
console.log(person.age);    // 30
console.log(person.score);  // 95

// Modify fields
person.score = 100;
console.log(person.score);  // 100

// Object in function
function dotProduct(x1: number, y1: number, x2: number, y2: number): number {
  return x1 * x2 + y1 * y2;
}
console.log(dotProduct(3, 4, 1, 2));  // 11

// === Maps ===

let map = new Map();
map.set(1, 10);
map.set(2, 20);
map.set(3, 30);
console.log(map.get(1));   // 10
console.log(map.get(3));   // 30
console.log(map.size);     // 3

// Map overwrite
map.set(2, 99);
console.log(map.get(2));  // 99

// Map has and delete
if (map.has(3)) {
  console.log(1);  // 1
}
map.delete(3);
console.log(map.size);  // 2
if (!map.has(3)) {
  console.log(1);  // 1
}

// Use map as counter
let counts = new Map();
let values: number[] = [1, 2, 1, 3, 2, 1];
for (let i: number = 0; i < values.length; i = i + 1) {
  let v: number = values[i];
  if (counts.has(v)) {
    counts.set(v, counts.get(v) + 1);
  } else {
    counts.set(v, 1);
  }
}
console.log(counts.get(1));  // 3
console.log(counts.get(2));  // 2
console.log(counts.get(3));  // 1
