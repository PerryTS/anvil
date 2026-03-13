// String method tests

let s: string = "hello world";

// length
console.log(s.length);  // 11

// indexOf
console.log(s.indexOf("world"));  // 6
console.log(s.indexOf("xyz"));    // -1

// includes
if (s.includes("hello")) {
  console.log(1);  // 1
}
if (!s.includes("xyz")) {
  console.log(1);  // 1
}

// startsWith / endsWith
if (s.startsWith("hello")) {
  console.log(1);  // 1
}
if (s.endsWith("world")) {
  console.log(1);  // 1
}

// slice
let sub: string = s.slice(6, 11);
console.log(sub);  // world

// charAt
let ch: string = s.charAt(0);
console.log(ch);  // h

// charCodeAt
console.log(s.charCodeAt(0));  // 104 (ASCII for 'h')

// toUpperCase / toLowerCase
let upper: string = s.toUpperCase();
console.log(upper);  // HELLO WORLD

let lower: string = upper.toLowerCase();
console.log(lower);  // hello world

// trim
let padded: string = "  hi  ";
let trimmed: string = padded.trim();
console.log(trimmed);  // hi

// replace
let replaced: string = s.replace("world", "there");
console.log(replaced);  // hello there
