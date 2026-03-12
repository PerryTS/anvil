// Object and Map tests

// Object literal
let point = { x: 10, y: 20, z: 30 };
console.log(point.x);  // 10
console.log(point.y);  // 20
console.log(point.z);  // 30

// Object field set
point.x = 99;
console.log(point.x);  // 99

// Map
let m = new Map();
m.set(1, 100);
m.set(2, 200);
m.set(3, 300);
console.log(m.get(1));  // 100
console.log(m.get(2));  // 200
console.log(m.get(3));  // 300
console.log(m.size);    // 3

// Map has/delete
if (m.has(2)) {
  console.log(1);  // 1
}
m.delete(2);
console.log(m.size);  // 2
if (!m.has(2)) {
  console.log(1);  // 1
}

// Function that takes and returns objects
function makePoint(x: number, y: number): number {
  let p = { x: x, y: y };
  return p.x + p.y;
}
console.log(makePoint(3, 4));  // 7
