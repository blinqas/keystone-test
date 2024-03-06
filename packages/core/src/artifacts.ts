import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { printSchema, GraphQLSchema } from 'graphql'
import { getGenerators, formatSchema } from '@prisma/internals'
import type { KeystoneConfig } from './types'
import { printGeneratedTypes } from './lib/typescript-schema-printer'
import { ExitError } from './scripts/utils'
import { initialiseLists } from './lib/core/initialise-lists'
import { printPrismaSchema } from './lib/core/prisma-schema-printer'
import { initConfig } from './system'

export function getFormattedGraphQLSchema (schema: string) {
  return (
    '# This file is automatically generated by Keystone, do not modify it manually.\n' +
    '# Modify your Keystone config when you want to change this.\n\n' +
    schema +
    '\n'
  )
}

export async function getCommittedArtifacts (config: KeystoneConfig, graphQLSchema: GraphQLSchema) {
  const lists = initialiseLists(config)
  const prismaSchema = printPrismaSchema(config, lists)
  return {
    graphql: getFormattedGraphQLSchema(printSchema(graphQLSchema)),
    prisma: await formatPrismaSchema(prismaSchema),
  }
}

let hasEnsuredBinariesExist = false
async function ensurePrismaBinariesExist () {
  // ensureBinariesExist does a bunch of slightly expensive things
  // so if we can avoid running it a bunch in tests, that's ideal
  if (hasEnsuredBinariesExist) return
  // we're resolving @prisma/engines from @prisma/internals
  // because we don't want to depend on @prisma/engines
  // since its version includes a commit hash from https://github.com/prisma/prisma-engines
  // and we just want to use whatever version @prisma/internals is using
  // also note we use an exact version of @prisma/internals
  // so if @prisma/internals suddenly stops depending on @prisma/engines
  // that won't break a released version of Keystone
  // also, we're not just directly importing @prisma/engines
  // since stricter package managers(e.g. pnpm, Yarn Berry)
  // don't allow importing packages that aren't explicitly depended on
  const requireFromPrismaSdk = createRequire(require.resolve('@prisma/internals'))
  const prismaEngines = requireFromPrismaSdk('@prisma/engines')
  await prismaEngines.ensureBinariesExist()
  hasEnsuredBinariesExist = true
}

async function formatPrismaSchema (schema: string) {
  await ensurePrismaBinariesExist()
  return formatSchema({ schema })
}

async function readFileButReturnNothingIfDoesNotExist (path: string) {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return
    }
    throw err
  }
}

// TODO: this cannot be changed for now, circular dependency with getSystemPaths, getEsbuildConfig
export function getBuiltKeystoneConfigurationPath (cwd: string) {
  return path.join(cwd, '.keystone/config.js')
}

export function getBuiltKeystoneConfiguration (cwd: string) {
  const configPath = getBuiltKeystoneConfigurationPath(cwd)
  return initConfig(require(configPath).default)
}

function posixify (s: string) {
  return s.split(path.sep).join('/')
}

export function getSystemPaths (cwd: string, config: KeystoneConfig) {
  const prismaClientPath = config.db.prismaClientPath === '@prisma/client'
    ? null
    : config.db.prismaClientPath
      ? path.join(cwd, config.db.prismaClientPath)
      : null

  const builtTypesPath = config.types?.path
    ? path.join(cwd, config.types.path) // TODO: enforce initConfig before getSystemPaths
    : path.join(cwd, 'node_modules/.keystone/types.ts')

  const builtPrismaPath = config.db?.prismaSchemaPath
    ? path.join(cwd, config.db.prismaSchemaPath) // TODO: enforce initConfig before getSystemPaths
    : path.join(cwd, 'schema.prisma')

  const relativePrismaPath = prismaClientPath
    ? `./${posixify(path.relative(path.dirname(builtTypesPath), prismaClientPath))}`
    : '@prisma/client'

  const builtGraphqlPath = config.graphql?.schemaPath
    ? path.join(cwd, config.graphql.schemaPath) // TODO: enforce initConfig before getSystemPaths
    : path.join(cwd, 'schema.graphql')

  return {
    config: getBuiltKeystoneConfigurationPath(cwd),
    admin: path.join(cwd, '.keystone/admin'),
    prisma: prismaClientPath ?? '@prisma/client',
    types: {
      relativePrismaPath,
    },
    schema: {
      types: builtTypesPath,
      prisma: builtPrismaPath,
      graphql: builtGraphqlPath,
    },
  }
}

export async function validatePrismaAndGraphQLSchemas (
  cwd: string,
  config: KeystoneConfig,
  graphQLSchema: GraphQLSchema
) {
  const paths = getSystemPaths(cwd, config)
  const artifacts = await getCommittedArtifacts(config, graphQLSchema)
  const [writtenGraphQLSchema, writtenPrismaSchema] = await Promise.all([
    readFileButReturnNothingIfDoesNotExist(paths.schema.graphql),
    readFileButReturnNothingIfDoesNotExist(paths.schema.prisma),
  ])
  const outOfDateSchemas = (() => {
    if (writtenGraphQLSchema !== artifacts.graphql && writtenPrismaSchema !== artifacts.prisma) {
      return 'both'
    }
    if (writtenGraphQLSchema !== artifacts.graphql) {
      return 'graphql'
    }
    if (writtenPrismaSchema !== artifacts.prisma) {
      return 'prisma'
    }
  })()
  if (!outOfDateSchemas) return

  const message = {
    both: 'Your Prisma and GraphQL schemas are not up to date',
    graphql: 'Your GraphQL schema is not up to date',
    prisma: 'Your Prisma schema is not up to date',
  }[outOfDateSchemas]
  console.error(message)

  throw new ExitError(1)
}

export async function generatePrismaAndGraphQLSchemas (
  cwd: string,
  config: KeystoneConfig,
  graphQLSchema: GraphQLSchema
) {
  const paths = getSystemPaths(cwd, config)
  const artifacts = await getCommittedArtifacts(config, graphQLSchema)

  await fs.writeFile(paths.schema.graphql, artifacts.graphql)
  await fs.writeFile(paths.schema.prisma, artifacts.prisma)
  return artifacts
}

export async function generateTypescriptTypes (
  cwd: string,
  config: KeystoneConfig,
  graphQLSchema: GraphQLSchema
) {
  const lists = initialiseLists(config)
  const paths = getSystemPaths(cwd, config)
  const schema = printGeneratedTypes(paths.types.relativePrismaPath, graphQLSchema, lists)

  await fs.mkdir(path.dirname(paths.schema.types), { recursive: true })
  await fs.writeFile(paths.schema.types, schema)
}

export async function generateTypescriptTypesAndPrisma (
  cwd: string,
  config: KeystoneConfig,
  graphQLSchema: GraphQLSchema
) {
  const paths = getSystemPaths(cwd, config)
  const dataProxy = config.db.url.startsWith('prisma:')
  if (dataProxy === true) {
    console.log('✨ Generating Prisma Client (data proxy)')
  }
  await Promise.all([
    generatePrismaClient(paths.schema.prisma, dataProxy),
    generateTypescriptTypes(cwd, config, graphQLSchema),
  ])
}

async function generatePrismaClient (prismaSchemaPath: string, dataProxy: boolean) {
  const generators = await getGenerators({
    schemaPath: prismaSchemaPath,
    dataProxy,
  })

  await Promise.all(
    generators.map(async generator => {
      try {
        await generator.generate()
      } finally {
        const closePromise = new Promise<void>(resolve => {
          const child = (generator as any).generatorProcess
            .child as import('child_process').ChildProcess
          child.once('exit', () => {
            resolve()
          })
        })
        generator.stop()
        await closePromise
      }
    })
  )
}
