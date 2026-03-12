// Type system for perrysdad HIR (mirrors perry-types)

export const enum TypeKind {
  Number = 0,
  String = 1,
  Boolean = 2,
  Undefined = 3,
  Null = 4,
  Void = 5,
  Any = 6,
  Never = 7,
  Object = 8,
  Array = 9,
  Function = 10,
  Union = 11,
  Int32 = 12,
  BigInt = 13,
}

export interface Type {
  kind: TypeKind;
}

export interface FunctionType extends Type {
  kind: TypeKind.Function;
  params: Array<Type>;
  returnType: Type;
}

export interface ArrayType extends Type {
  kind: TypeKind.Array;
  elementType: Type;
}

export interface UnionType extends Type {
  kind: TypeKind.Union;
  members: Array<Type>;
}

export interface ObjectType extends Type {
  kind: TypeKind.Object;
  fields: Map<string, Type>;
}

export const NUMBER_TYPE: Type = { kind: TypeKind.Number };
export const STRING_TYPE: Type = { kind: TypeKind.String };
export const BOOLEAN_TYPE: Type = { kind: TypeKind.Boolean };
export const UNDEFINED_TYPE: Type = { kind: TypeKind.Undefined };
export const NULL_TYPE: Type = { kind: TypeKind.Null };
export const VOID_TYPE: Type = { kind: TypeKind.Void };
export const ANY_TYPE: Type = { kind: TypeKind.Any };
export const NEVER_TYPE: Type = { kind: TypeKind.Never };
export const INT32_TYPE: Type = { kind: TypeKind.Int32 };

export function makeFunctionType(params: Array<Type>, returnType: Type): FunctionType {
  return { kind: TypeKind.Function, params: params, returnType: returnType };
}

export function makeArrayType(elementType: Type): ArrayType {
  return { kind: TypeKind.Array, elementType: elementType };
}

export function makeUnionType(members: Array<Type>): UnionType {
  return { kind: TypeKind.Union, members: members };
}

export function makeObjectType(fields: Map<string, Type>): ObjectType {
  return { kind: TypeKind.Object, fields: fields };
}

export function isDynamic(ty: Type): boolean {
  return ty.kind === TypeKind.Any || ty.kind === TypeKind.Union;
}

export function isNumber(ty: Type): boolean {
  return ty.kind === TypeKind.Number;
}

export function isString(ty: Type): boolean {
  return ty.kind === TypeKind.String;
}

export function isBoolean(ty: Type): boolean {
  return ty.kind === TypeKind.Boolean;
}

export function isVoid(ty: Type): boolean {
  return ty.kind === TypeKind.Void || ty.kind === TypeKind.Undefined;
}
