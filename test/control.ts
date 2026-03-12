let sum: number = 0;
for (let i: number = 1; i <= 10; i = i + 1) {
  sum = sum + i;
}
console.log(sum);

let n: number = 10;
while (n > 0) {
  n = n - 1;
}
console.log(n);

if (sum > 50) {
  console.log(1);
} else {
  console.log(0);
}
