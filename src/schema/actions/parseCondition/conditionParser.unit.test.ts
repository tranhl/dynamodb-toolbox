import { DynamoDBToolboxError } from '~/errors/dynamoDBToolboxError.js'
import { any, anyOf, item, list, map, number, record, string } from '~/schema/index.js'
import { jsonStringify } from '~/transformers/jsonStringify.js'

import { ConditionParser } from './conditionParser.js'

/**
 * @debt test "validate the attr value is a string"
 */

describe('parseCondition', () => {
  describe('savedAs attrs', () => {
    const schemaWithSavedAs = item({
      savedAs: string().savedAs('_s'),
      deep: map({
        savedAs: string().savedAs('_s')
      }).savedAs('_n'),
      listed: list(
        map({
          savedAs: string().savedAs('_s')
        })
      ).savedAs('_l')
    })

    test('correctly parses condition (root)', () => {
      expect(
        schemaWithSavedAs.build(ConditionParser).parse({ attr: 'savedAs', beginsWith: 'foo' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c_1, :c_1)',
        ExpressionAttributeNames: { '#c_1': '_s' },
        ExpressionAttributeValues: { ':c_1': 'foo' }
      })
    })

    test('correctly parses condition (deep)', () => {
      expect(
        schemaWithSavedAs.build(ConditionParser).parse({ attr: 'deep.savedAs', beginsWith: 'foo' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c_1.#c_2, :c_1)',
        ExpressionAttributeNames: { '#c_1': '_n', '#c_2': '_s' },
        ExpressionAttributeValues: { ':c_1': 'foo' }
      })
    })

    test('correctly parses condition (with id)', () => {
      expect(
        schemaWithSavedAs
          .build(ConditionParser)
          .parse({ attr: 'savedAs', beginsWith: 'foo' }, { expressionId: '1' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c1_1, :c1_1)',
        ExpressionAttributeNames: { '#c1_1': '_s' },
        ExpressionAttributeValues: { ':c1_1': 'foo' }
      })
    })

    test('correctly parses condition (listed)', () => {
      expect(
        schemaWithSavedAs
          .build(ConditionParser)
          .parse({ attr: 'listed[4].savedAs', beginsWith: 'foo' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c_1[4].#c_2, :c_1)',
        ExpressionAttributeNames: { '#c_1': '_l', '#c_2': '_s' },
        ExpressionAttributeValues: { ':c_1': 'foo' }
      })
    })
  })

  describe('anyOf', () => {
    const schemaWithAnyOf = item({
      anyOf: anyOf(
        number(),
        map({
          strOrNum: anyOf(string(), number())
        })
      )
    })

    test('correctly parses condition (root)', () => {
      expect(
        schemaWithAnyOf.build(ConditionParser).parse({ attr: 'anyOf', between: [42, 43] })
      ).toStrictEqual({
        ConditionExpression: '#c_1 BETWEEN :c_1 AND :c_2',
        ExpressionAttributeNames: { '#c_1': 'anyOf' },
        ExpressionAttributeValues: { ':c_1': 42, ':c_2': 43 }
      })
    })

    test('correctly parses condition (deep num)', () => {
      expect(
        schemaWithAnyOf.build(ConditionParser).parse({ attr: 'anyOf.strOrNum', between: [42, 43] })
      ).toStrictEqual({
        ConditionExpression: '#c_1.#c_2 BETWEEN :c_1 AND :c_2',
        ExpressionAttributeNames: { '#c_1': 'anyOf', '#c_2': 'strOrNum' },
        ExpressionAttributeValues: { ':c_1': 42, ':c_2': 43 }
      })
    })

    test('correctly parses condition (deep str)', () => {
      expect(
        schemaWithAnyOf.build(ConditionParser).parse({ attr: 'anyOf.strOrNum', beginsWith: 'foo' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c_1.#c_2, :c_1)',
        ExpressionAttributeNames: { '#c_1': 'anyOf', '#c_2': 'strOrNum' },
        ExpressionAttributeValues: { ':c_1': 'foo' }
      })
    })
  })

  describe('anyOf (discriminated)', () => {
    const schemaWithAnyOf = item({
      anyOf: anyOf(
        map({ status: string().enum('a') }),
        map({ status: string().enum('b') }),
        map({ status: string().enum('c') })
      )
    })

    test('correctly parses condition (deep str)', () => {
      expect(
        schemaWithAnyOf.build(ConditionParser).parse({ attr: 'anyOf.status', eq: 'b' })
      ).toStrictEqual({
        ConditionExpression: '#c_1.#c_2 = :c_1',
        ExpressionAttributeNames: { '#c_1': 'anyOf', '#c_2': 'status' },
        ExpressionAttributeValues: { ':c_1': 'b' }
      })
    })
  })

  describe('any (transformed)', () => {
    const schemaWithTransformedAny = item({
      any: any().castAs<{ foo: 'bar' }>().transform(jsonStringify())
    })

    test('correctly parses condition (deep str)', () => {
      expect(
        schemaWithTransformedAny.build(ConditionParser).parse({ attr: 'any', eq: { foo: 'bar' } })
      ).toStrictEqual({
        ConditionExpression: '#c_1 = :c_1',
        ExpressionAttributeNames: { '#c_1': 'any' },
        ExpressionAttributeValues: { ':c_1': JSON.stringify({ foo: 'bar' }) }
      })
    })
  })

  describe('special chars', () => {
    const schemaWithSpecChars = item({
      record: record(string(), string()),
      map: map({ '[': string() }),
      ']': string()
    })

    test('fails when not escaping special chars', () => {
      const invalidCallA = () =>
        schemaWithSpecChars.build(ConditionParser).parse({ attr: 'record.[', beginsWith: 'foo' })

      expect(invalidCallA).toThrow(DynamoDBToolboxError)
      expect(invalidCallA).toThrow(
        expect.objectContaining({ code: 'actions.invalidExpressionAttributePath' })
      )

      const invalidCallB = () =>
        schemaWithSpecChars.build(ConditionParser).parse({ attr: 'map.[', beginsWith: 'foo' })

      expect(invalidCallB).toThrow(DynamoDBToolboxError)
      expect(invalidCallB).toThrow(
        expect.objectContaining({ code: 'actions.invalidExpressionAttributePath' })
      )

      const invalidCallC = () =>
        schemaWithSpecChars.build(ConditionParser).parse({ attr: ']', beginsWith: 'foo' })

      expect(invalidCallC).toThrow(DynamoDBToolboxError)
      expect(invalidCallC).toThrow(
        expect.objectContaining({ code: 'actions.invalidExpressionAttributePath' })
      )
    })

    test('correctly parses condition with escaped keys (record)', () => {
      expect(
        schemaWithSpecChars.build(ConditionParser).parse({ attr: `record['[']`, beginsWith: 'foo' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c_1.#c_2, :c_1)',
        ExpressionAttributeNames: { '#c_1': 'record', '#c_2': '[' },
        ExpressionAttributeValues: { ':c_1': 'foo' }
      })
    })

    test('correctly parses condition with escaped keys (map)', () => {
      expect(
        schemaWithSpecChars.build(ConditionParser).parse({ attr: `map['[']`, beginsWith: 'foo' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c_1.#c_2, :c_1)',
        ExpressionAttributeNames: { '#c_1': 'map', '#c_2': '[' },
        ExpressionAttributeValues: { ':c_1': 'foo' }
      })
    })

    test('correctly parses condition with escaped keys (schema)', () => {
      expect(
        schemaWithSpecChars.build(ConditionParser).parse({ attr: `[']']`, beginsWith: 'foo' })
      ).toStrictEqual({
        ConditionExpression: 'begins_with(#c_1, :c_1)',
        ExpressionAttributeNames: { '#c_1': ']' },
        ExpressionAttributeValues: { ':c_1': 'foo' }
      })
    })
  })
})
