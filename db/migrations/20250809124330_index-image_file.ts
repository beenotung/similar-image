import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('image', table => {
    table.unique('file')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('image', table => {
    table.dropUnique(['file'])
  })
}
