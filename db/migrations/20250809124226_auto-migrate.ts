import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('image'))) {
    await knex.schema.createTable('image', table => {
      table.increments('id')
      table.text('file').notNullable()
      table.binary('embedding').notNullable()
      table.timestamps(false, true)
    })
  }

  if (!(await knex.schema.hasTable('annotation'))) {
    await knex.schema.createTable('annotation', table => {
      table.increments('id')
      table.integer('a_image_id').unsigned().notNullable().references('image.id')
      table.integer('b_image_id').unsigned().notNullable().references('image.id')
      table.boolean('is_similar').notNullable()
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('annotation')
  await knex.schema.dropTableIfExists('image')
}
