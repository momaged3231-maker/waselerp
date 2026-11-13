import { Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

export interface PartyDto {
  partyId?: number;
  code?: string;
  name: string;
  nameEn?: string;
  partyType: number;
  phone?: string;
  mobile?: string;
  address?: string;
  taxNumber?: string;
  creditLimit?: number;
  discountPct?: number;
  isActive?: boolean;
  notes?: string;
  priceListId?: number | null;
}

@Injectable()
export class PartiesService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: { search?: string; type?: number; page: number; pageSize: number }) {
    const offset = (params.page - 1) * params.pageSize;
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    const type = params.type ?? 0;

    const where = `WHERE ($1::text = '' OR p.name ILIKE $2 OR COALESCE(p.code,'') ILIKE $2 OR COALESCE(p.phone,'') ILIKE $2)
                   AND ($3::int = 0 OR p.party_type = $3 OR p.party_type = 3)`;

    const items = await this.db.query(
      `SELECT p.party_id AS "partyId", p.code, p.name, p.name_en AS "nameEn", p.party_type AS "partyType",
              p.phone, p.mobile, p.address, p.tax_number AS "taxNumber",
              p.credit_limit AS "creditLimit", p.discount_pct AS "discountPct", p.is_active AS "isActive",
              p.price_list_id AS "priceListId", pl.name AS "priceListName",
              COALESCE((SELECT SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END)
                          FROM ledger_entries l WHERE l.party_id = p.party_id), p.opening_balance) AS balance
         FROM parties p
         LEFT JOIN price_lists pl ON pl.price_list_id = p.price_list_id ${where}
        ORDER BY p.name LIMIT $4 OFFSET $5`,
      [search, like, type, params.pageSize, offset],
    );

    const total = await this.db.count(`SELECT COUNT(*)::int AS count FROM parties p ${where}`, [search, like, type]);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async findOne(id: number) {
    const row = await this.db.one(
      `SELECT p.party_id AS "partyId", p.code, p.name, p.name_en AS "nameEn", p.party_type AS "partyType",
              p.phone, p.mobile, p.address, p.tax_number AS "taxNumber", p.city, p.area,
              p.credit_limit AS "creditLimit", p.discount_pct AS "discountPct", p.is_active AS "isActive",
              p.price_list_id AS "priceListId", pl.name AS "priceListName",
              p.notes, p.opening_balance AS "openingBalance",
              COALESCE((SELECT SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END)
                          FROM ledger_entries l WHERE l.party_id = p.party_id), p.opening_balance) AS balance
         FROM parties p LEFT JOIN price_lists pl ON pl.price_list_id = p.price_list_id
        WHERE p.party_id = $1`,
      [id],
    );
    if (!row) return null;

    const ledger = await this.db.query(
      `SELECT l.ledger_entry_id AS "entryId", l.entry_date AS "entryDate", l.direction, l.entry_type AS "entryType",
              l.amount, l.reference_no AS "referenceNo", l.notes, i.invoice_no AS "invoiceNo"
         FROM ledger_entries l LEFT JOIN invoices i ON i.invoice_id = l.invoice_id
        WHERE l.party_id = $1 ORDER BY l.entry_date DESC, l.ledger_entry_id DESC LIMIT 200`,
      [id],
    );
    return { ...row, ledger };
  }

  async create(dto: PartyDto, user: AuthUser) {
    const row = await this.db.one(
      `INSERT INTO parties (code, name, name_en, party_type, branch_id, address, phone, mobile, tax_number,
                            credit_limit, discount_pct, is_active, notes, price_list_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING party_id`,
      [
        dto.code ?? null, dto.name, dto.nameEn ?? null, dto.partyType, user.defaultBranchId,
        dto.address ?? null, dto.phone ?? null, dto.mobile ?? null, dto.taxNumber ?? null,
        dto.creditLimit ?? 0, dto.discountPct ?? 0, dto.isActive ?? true, dto.notes ?? null,
        dto.priceListId ? Number(dto.priceListId) : null,
      ],
    );
    return { partyId: row.party_id };
  }

  async update(id: number, dto: PartyDto) {
    await this.db.query(
      `UPDATE parties SET code=$2, name=$3, name_en=$4, party_type=$5, address=$6, phone=$7, mobile=$8,
              tax_number=$9, credit_limit=$10, discount_pct=$11, is_active=$12, notes=$13,
              price_list_id=$14, version = version + 1
        WHERE party_id=$1`,
      [
        id, dto.code ?? null, dto.name, dto.nameEn ?? null, dto.partyType, dto.address ?? null,
        dto.phone ?? null, dto.mobile ?? null, dto.taxNumber ?? null, dto.creditLimit ?? 0,
        dto.discountPct ?? 0, dto.isActive ?? true, dto.notes ?? null,
        dto.priceListId === undefined ? undefined : (dto.priceListId ? Number(dto.priceListId) : null),
      ],
    );
    return { partyId: id };
  }

  /** Receivables / payables report for one party. */
  async statement(id: number) {
    const party = await this.findOne(id);
    if (!party) return null;
    const rows = await this.db.query(
      `SELECT l.ledger_entry_id AS "entryId", l.entry_date AS "entryDate", l.direction, l.entry_type AS "entryType",
              l.amount, l.reference_no AS "referenceNo", l.notes, i.invoice_no AS "invoiceNo"
         FROM ledger_entries l LEFT JOIN invoices i ON i.invoice_id = l.invoice_id
        WHERE l.party_id = $1 ORDER BY l.entry_date, l.ledger_entry_id`,
      [id],
    );
    let running = Number(party.openingBalance ?? 0);
    const lines = rows.map((row: any) => {
      running += row.direction === 1 ? Number(row.amount) : -Number(row.amount);
      return { ...row, running };
    });
    return { party, lines, closingBalance: running };
  }
}

@Controller('parties')
export class PartiesController {
  constructor(private readonly service: PartiesService) {}

  @RequirePermissions('parties.view')
  @Get()
  list(@Query('search') search: string, @Query('type') type: string, @Query('page') page: string, @Query('pageSize') pageSize: string) {
    return this.service.list({
      search,
      type: type ? Number(type) : 0,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 200),
    });
  }

  @RequirePermissions('parties.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @RequirePermissions('parties.ledger')
  @Get(':id/statement')
  statement(@Param('id', ParseIntPipe) id: number) {
    return this.service.statement(id);
  }

  @RequirePermissions('parties.manage')
  @Post()
  create(@Body() dto: PartyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @RequirePermissions('parties.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: PartyDto) {
    return this.service.update(id, dto);
  }
}

@Module({
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
