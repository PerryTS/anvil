// Array tests

// Array literal and indexing
let arr: number[] = [10, 20, 30];
console.log(arr[0]);   // 10
console.log(arr[1]);   // 20
console.log(arr[2]);   // 30

// Array length
console.log(arr.length);  // 3

// Array push
arr.push(40);
console.log(arr.length);  // 4
console.log(arr[3]);      // 40

// Array set
arr[1] = 99;
console.log(arr[1]);  // 99

// Array pop
let popped: number = arr.pop();
console.log(popped);       // 40
console.log(arr.length);   // 3

// Build array in loop
let squares: number[] = [];
for (let i: number = 0; i < 5; i = i + 1) {
  squares.push(i * i);
}
console.log(squares[0]);  // 0
console.log(squares[1]);  // 1
console.log(squares[2]);  // 4
console.log(squares[3]);  // 9
console.log(squares[4]);  // 16
console.log(squares.length);  // 5

// Sum array elements
let sum: number = 0;
for (let i: number = 0; i < squares.length; i = i + 1) {
  sum = sum + squares[i];
}
console.log(sum);  // 30
