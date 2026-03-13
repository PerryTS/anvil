// Class tests

class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  distanceTo(other: Point): number {
    let dx: number = this.x - other.x;
    let dy: number = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  translate(dx: number, dy: number): void {
    this.x = this.x + dx;
    this.y = this.y + dy;
  }
}

let p1 = new Point(3, 4);
console.log(p1.x);    // 3
console.log(p1.y);    // 4

let p2 = new Point(0, 0);
console.log(p2.x);    // 0
console.log(p2.y);    // 0

// Method call
console.log(p1.distanceTo(p2));  // 5 (3-4-5 triangle)

// Mutate via method
p1.translate(1, 1);
console.log(p1.x);    // 4
console.log(p1.y);    // 5

// Class with default values
class Counter {
  count: number;

  constructor() {
    this.count = 0;
  }

  increment(): void {
    this.count = this.count + 1;
  }

  getCount(): number {
    return this.count;
  }
}

let c = new Counter();
console.log(c.getCount());  // 0
c.increment();
c.increment();
c.increment();
console.log(c.getCount());  // 3

// Class with method calling another method
class Accumulator {
  total: number;

  constructor() {
    this.total = 0;
  }

  add(n: number): void {
    this.total = this.total + n;
  }

  addTwice(n: number): void {
    this.add(n);
    this.add(n);
  }

  getTotal(): number {
    return this.total;
  }
}

let acc = new Accumulator();
acc.add(10);
console.log(acc.getTotal());  // 10
acc.addTwice(5);
console.log(acc.getTotal());  // 20
