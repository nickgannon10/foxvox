export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/recall/**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.recall.json' }] },
  moduleNameMapper: { '\\.css$': '<rootDir>/tests/recall/style-mock.cjs' },
  clearMocks: true,
};
