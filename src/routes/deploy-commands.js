import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from '../config/env.js';
import { ORDER_TICKET_SERVICES } from '../config/constants.js';

const serviceCommands = [
  ['order', 'Ticket order'],
  ['support', 'Ticket support'],
  ['limited', 'Limited item'],
  ['via-login', 'Via login'],
  ['via-username', 'Via username'],
  ['group-payout', 'Group payout'],
  ['gift-gamepass', 'Gift gamepass']
];

const editablePanels = [
  ['price_via_login', 'Price Via Login'],
  ['price_via_username', 'Price Via Username'],
  ['market_item_tumbal_trade', 'Item Tumbal Trade'],
  ['market_value_update', 'Value Update Realtime']
];

function addServiceSubcommands(command) {
  for (const [name, description] of serviceCommands) {
    command.addSubcommand((subcommand) =>
      subcommand
        .setName(name)
        .setDescription(description)
    );
  }

  return command;
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup-server')
    .setDescription('Buat role, channel, panel verify, panel ticket, dan payment WS Store.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('refresh-panels')
    .setDescription('Refresh semua panel WS Store yang terdaftar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('add-transaction')
    .setDescription('Tambah transaksi manual dan update tier customer.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option.setName('buyer').setDescription('Pembeli').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Nominal rupiah').setRequired(true).setMinValue(0)
    )
    .addStringOption((option) =>
      option.setName('product').setDescription('Produk').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('payment').setDescription('Metode pembayaran').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('customer')
    .setDescription('Cek total transaksi dan tier customer.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Customer yang dicek').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('open-ticket')
    .setDescription('Staff membuka ticket untuk member tertentu, termasuk di luar jam operasional.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option.setName('user').setDescription('Member yang dibuatkan ticket').setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Jenis ticket')
        .setRequired(true)
        .addChoices(
          { name: 'Order', value: 'order' },
          { name: 'Rekber', value: 'rekber' },
          { name: 'Support', value: 'support' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('service')
        .setDescription('Layanan order opsional jika type Order')
        .setRequired(false)
        .addChoices(...ORDER_TICKET_SERVICES.map(({ service, label }) => ({ name: label, value: service })))
    ),
  new SlashCommandBuilder()
    .setName('set-panel-text')
    .setDescription('Ubah teks panel market/pricelist tanpa edit kode.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('panel')
        .setDescription('Panel yang ingin diubah')
        .setRequired(true)
        .addChoices(...editablePanels.map(([value, name]) => ({ name, value })))
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Isi teks embed. Gunakan Shift+Enter untuk baris baru.')
        .setRequired(true)
        .setMaxLength(4000)
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('Judul embed opsional')
        .setRequired(false)
        .setMaxLength(256)
    ),
  new SlashCommandBuilder()
    .setName('reset-panel-text')
    .setDescription('Kembalikan teks panel market/pricelist ke default kode.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('panel')
        .setDescription('Panel yang ingin direset')
        .setRequired(true)
        .addChoices(...editablePanels.map(([value, name]) => ({ name, value })))
    ),
  addServiceSubcommands(
    new SlashCommandBuilder()
      .setName('open')
      .setDescription('Set service WS Store menjadi OPEN.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ),
  addServiceSubcommands(
    new SlashCommandBuilder()
      .setName('close')
      .setDescription('Set service WS Store menjadi CLOSED.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Kelola giveaway WS Store.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Buat giveaway baru.')
        .addStringOption((option) =>
          option.setName('prize').setDescription('Hadiah giveaway, contoh: Total 2000 Robux (4 orang)').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('duration').setDescription('Durasi giveaway, contoh: 30m, 4h, 1d').setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName('winners').setDescription('Jumlah winner').setRequired(false).setMinValue(1).setMaxValue(20)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('end')
        .setDescription('Akhiri giveaway lebih cepat.')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID giveaway').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reroll')
        .setDescription('Undi ulang winner giveaway.')
        .addIntegerOption((option) =>
          option.setName('id').setDescription('ID giveaway').setRequired(true).setMinValue(1)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discordToken);

await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  { body: commands }
);

console.log(`Registered ${commands.length} slash commands for ${config.storeName}.`);
