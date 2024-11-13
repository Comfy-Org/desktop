module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  automock: false,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  verbose: true,
  collectCoverage: true,
  coverageReporters: [
    "text",
    "cobertura"
  ]
};
