import {
  Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/security';
import { buildEtaInvoiceXml, EtaInvoiceLine } from './eta-xml';
import {
  buildEtaQrPayload, buildSimplifiedEtaQrPayload, computeInvoiceHash, qrToPngBase64, signInvoiceHash,
} from './eta-qr';
import { generateEgyptianUuid, sellerEgsUuid } from './eta-uuid';

export interface EtaConfigRow {
  config_id: number;
  seller_name: string;
  seller_vat_number: string;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  seller_registration_id: string | null;
  seller_logo: string | null;
  egs_uuid: string | null;
  environment: string;
  api_base_url: string | null;
  token_url: string | null;
  client_id: string | null;
  client_secret: string | null;
  private_key: string | null;
  certificate: string | null;
  is_active: boolean;
}

/**
 * Egyptian e-invoicing (ETA — هيئة الضرائب المصرية).
 *
 * Produces the UBL 2.1 document, the internal UUID, the signed hash and the
 * QR code required on every Egyptian tax invoice.
 */
@Injectable()
export class EtaService {
  constructor(private readonly db: DatabaseService) {}

  async getConfig(): Promise<EtaConfigRow | null> {
    return this.db.one<EtaConfigRow>('SELECT * FROM eta_config ORDER BY config_id LIMIT 1');
  }

  async saveConfig(body: any): Promise<EtaConfigRow> {
    const current = await this.getConfig();
    // The admin screen sends the raw row (snake_case); the API is camelCase.
    const pick = (camel: string, snake: string) => body[camel] ?? body[snake];
    const values = {
      seller_name: pick('sellerName', 'seller_name') ?? current?.seller_name ?? '',
      seller_vat_number: pick('vatNumber', 'seller_vat_number') ?? current?.seller_vat_number ?? '',
      seller_address: pick('address', 'seller_address') ?? current?.seller_address ?? null,
      seller_email: pick('email', 'seller_email') ?? current?.seller_email ?? null,
      seller_phone: pick('phone', 'seller_phone') ?? current?.seller_phone ?? null,
      seller_registration_id: pick('registrationId', 'seller_registration_id') ?? current?.seller_registration_id ?? null,
      seller_logo: pick('logoBase64', 'seller_logo') ?? current?.seller_logo ?? null,
      egs_uuid: pick('egsUuid', 'egs_uuid') ?? current?.egs_uuid ?? null,
      environment: pick('environment', 'environment') ?? current?.environment ?? 'sandbox',
      api_base_url: pick('apiBaseUrl', 'api_base_url') ?? current?.api_base_url ?? null,
      token_url: pick('tokenUrl', 'token_url') ?? current?.token_url ?? null,
      client_id: pick('clientId', 'client_id') ?? current?.client_id ?? null,
      client_secret: pick('clientSecret', 'client_secret') ?? current?.client_secret ?? null,
      private_key: pick('privateKey', 'private_key') ?? current?.private_key ?? null,
      certificate: pick('certificate', 'certificate') ?? current?.certificate ?? null,
      is_active: pick('isActive', 'is_active') ?? current?.is_active ?? false,
    };

    if (current) {
      await this.db.query(
        `UPDATE eta_config SET seller_name=$2, seller_vat_number=$3, seller_address=$4, seller_email=$5,
                seller_phone=$6, seller_registration_id=$7, seller_logo=$8, egs_uuid=$9, environment=$10,
                api_base_url=$11, token_url=$12, client_id=$13, client_secret=$14, private_key=$15,
                certificate=$16, is_active=$17, updated_at=now()
          WHERE config_id=$1`,
        [current.config_id, ...Object.values(values)],
      );
    } else {
      await this.db.query(
        `INSERT INTO eta_config (seller_name, seller_vat_number, seller_address, seller_email, seller_phone,
                seller_registration_id, seller_logo, egs_uuid, environment, api_base_url, token_url,
                client_id, client_secret, private_key, certificate, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        Object.values(values),
      );
    }
    return (await this.getConfig())!;
  }

  async status() {
    const config = await this.getConfig();
    const invoices = await this.db.query(
      'SELECT status, COUNT(*)::int AS count FROM eta_invoices GROUP BY status',
    );
    return {
      configured: !!config?.is_active && !!config?.seller_vat_number,
      environment: config?.environment ?? 'sandbox',
      sellerName: config?.seller_name ?? null,
      vatNumber: config?.seller_vat_number ?? null,
      egsUuid: config?.egs_uuid ?? null,
      hasCertificate: !!config?.certificate,
      hasPrivateKey: !!config?.private_key,
      hasEndpoint: !!config?.api_base_url,
      invoiceCounts: invoices,
    };
  }

  /** Builds, signs and stores the ETA document of an invoice. */
  async generate(invoiceId: number, body: { invoiceType?: 1 | 2 } = {}) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('إعدادات ETA غير مهيأة');
    if (!config.seller_vat_number) throw new BadRequestException('سجّل الرقم الضريبي للبائع أولًا');

    const invoice = await this.db.one<any>(
      `SELECT i.*, p.name AS party_name, p.tax_number AS party_tax_number, p.address AS party_address,
              p.email AS party_email, p.phone AS party_phone
         FROM invoices i LEFT JOIN parties p ON p.party_id = i.party_id
        WHERE i.invoice_id = $1`,
      [invoiceId],
    );
    if (!invoice) throw new BadRequestException('الفاتورة غير موجودة');
    if (Number(invoice.invoice_type) !== 1) {
      throw new BadRequestException('فاتورة ETA تُولَّد من فاتورة بيع فقط');
    }

    const lines = await this.db.query<any>(
      `SELECT l.*, it.name AS item_name, u.name AS unit_name
         FROM invoice_lines l JOIN items it ON it.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.invoice_id = $1 ORDER BY l.line_number`,
      [invoiceId],
    );

    const invoiceType = body.invoiceType ?? 2;
    const uuid = generateEgyptianUuid();
    const egsUuid = config.egs_uuid
      ?? sellerEgsUuid(config.seller_registration_id ?? config.seller_vat_number);

    const mapped: EtaInvoiceLine[] = lines.map((line) => ({
      itemId: line.item_id,
      name: line.item_name,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
      discountAmount: Number(line.discount_amount),
      taxAmount: Number(line.tax_amount),
      taxPct: Number(line.tax_pct),
      lineTotal: Number(line.line_total),
      unitCode: line.unit_name ?? 'EA',
    }));

    const data = {
      uuid,
      invoiceNumber: invoice.invoice_no,
      issueDate: new Date(invoice.invoice_date).toISOString(),
      invoiceType: invoiceType as 1 | 2,
      seller: {
        name: config.seller_name ?? 'WaselERP',
        vatNumber: config.seller_vat_number ?? '',
        address: config.seller_address ?? '',
        email: config.seller_email ?? '',
        phone: config.seller_phone ?? '',
        registrationId: config.seller_registration_id ?? undefined,
        logoBase64: config.seller_logo,
      },
      buyer: {
        name: invoice.party_name ?? 'عميل نقدي',
        vatNumber: invoice.party_tax_number ?? null,
        address: invoice.party_address ?? '',
        email: invoice.party_email ?? '',
        phone: invoice.party_phone ?? '',
      },
      lines: mapped,
      subtotal: Number(invoice.sub_total),
      discountAmount: Number(invoice.discount_amount),
      taxAmount: Number(invoice.tax_amount),
      totalAmount: Number(invoice.total_amount),
      allowanceTotal: Number(invoice.discount_amount),
      notes: invoice.notes ?? '',
    };

    // 1. XML without the signature
    const plainXml = buildEtaInvoiceXml(data);
    // 2. hash + signature over that XML
    const invoiceHash = computeInvoiceHash(plainXml);
    let signature = '';
    if (config.private_key) {
      try {
        signature = signInvoiceHash(invoiceHash, config.private_key);
      } catch {
        signature = '';
      }
    }
    // 3. embed the signature (standard invoices only)
    const certificateBase64 = (config.certificate ?? '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const xml = invoiceType === 2 && config.certificate && signature
      ? buildEtaInvoiceXml(data, { certificateBase64, signatureValueBase64: signature, hashBase64: invoiceHash })
      : plainXml;

    // 4. QR payload
    const qrInput = {
      sellerName: data.seller.name,
      vatNumber: data.seller.vatNumber,
      timestamp: data.issueDate,
      totalWithVat: data.totalAmount,
      vatTotal: data.taxAmount,
      egsUuid,
      invoiceUuid: uuid,
      publicId: null,
    };
    const qrBuffer = invoiceType === 2
      ? buildEtaQrPayload(qrInput)
      : buildSimplifiedEtaQrPayload(qrInput);
    const qrPng = await qrToPngBase64(qrBuffer);

    const saved = await this.db.one<any>(
      `INSERT INTO eta_invoices (invoice_id, invoice_uuid, invoice_type, xml, qr_data, qr_png_base64,
              invoice_hash, signature, egs_uuid, status)
       VALUES ($1::bigint,$2,$3::int,$4,$5,$6,$7,$8,$9,1)
       ON CONFLICT (invoice_uuid) DO UPDATE SET
         xml = EXCLUDED.xml, qr_data = EXCLUDED.qr_data, qr_png_base64 = EXCLUDED.qr_png_base64,
         invoice_hash = EXCLUDED.invoice_hash, signature = EXCLUDED.signature
       RETURNING eta_invoice_id AS "etaInvoiceId", invoice_uuid AS "invoiceUuid", invoice_hash AS "invoiceHash"`,
      [invoiceId, uuid, invoiceType, xml, qrBuffer.toString('base64'), qrPng, invoiceHash,
        signature, egsUuid],
    );

    return {
      etaInvoiceId: saved.eta_invoice_id,
      uuid,
      egsUuid,
      invoiceHash,
      xml,
      qrPngBase64: qrPng,
      qrDataBase64: qrBuffer.toString('base64'),
      signed: !!signature,
      status: 'pending',
    };
  }

  /**
   * Sends the document to the ETA gateway.
   * The endpoint, the token URL and the client credentials come from the
   * configuration so the module works with the real (or a mock) gateway.
   */
  async submit(invoiceId: number) {
    const config = await this.getConfig();
    if (!config?.api_base_url) {
      throw new BadRequestException('عنوان بوابة ETA غير مضبوط في الإعدادات');
    }
    const document = await this.db.one<any>(
      'SELECT * FROM eta_invoices WHERE invoice_id = $1::bigint ORDER BY eta_invoice_id DESC LIMIT 1',
      [invoiceId],
    );
    if (!document) throw new BadRequestException('لم يتم توليد المستند بعد');

    const isStandard = Number(document.invoice_type) === 2;
    const path = isStandard ? '/api/v1/invoices/clearance' : '/api/v1/invoices/reporting';
    const base = config.api_base_url.replace(/\/$/, '');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Version': 'V1',
      'Accept-Language': 'en',
    };
    if (config.client_id && config.client_secret) {
      const authorization = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');
      headers.Authorization = `Basic ${authorization}`;
    }
    if (config.certificate) {
      headers['Certificate-Signature'] = Buffer.from(config.certificate, 'utf8').toString('base64');
    }

    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invoiceHash: document.invoice_hash,
        uuid: document.invoice_uuid,
        invoice: Buffer.from(document.xml, 'utf8').toString('base64'),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    const ok = response.ok && !(payload as any).validationResults?.errorMessages?.length;
    const publicId = (payload as any)?.validationResults?.infoMessages?.find?.(
      (message: any) => message.code === 'PUBLIC_ID',
    )?.message ?? null;

    await this.db.query(
      `UPDATE eta_invoices SET status = $2, eta_response = $3::jsonb, public_id = $4,
              submitted_at = CASE WHEN $5 THEN now() ELSE submitted_at END
        WHERE eta_invoice_id = $1::bigint`,
      [document.eta_invoice_id, ok ? (isStandard ? 2 : 3) : 4, JSON.stringify(payload), publicId, ok],
    );

    return { ok, status: response.status, response: payload, publicId };
  }

  async list(limit = 50) {
    return this.db.query<any>(
      `SELECT e.eta_invoice_id AS "etaInvoiceId", e.invoice_uuid AS "invoiceUuid",
              e.invoice_type AS "invoiceType", e.status, e.invoice_hash AS "invoiceHash",
              e.public_id AS "publicId", e.created_at AS "createdAt", e.submitted_at AS "submittedAt",
              i.invoice_no AS "invoiceNo", i.total_amount AS "totalAmount", i.invoice_date AS "invoiceDate"
         FROM eta_invoices e LEFT JOIN invoices i ON i.invoice_id = e.invoice_id
        ORDER BY e.eta_invoice_id DESC LIMIT $1`,
      [limit],
    );
  }

  async getDocument(invoiceId: number) {
    return this.db.one<any>(
      `SELECT e.*, i.invoice_no AS "invoiceNo" FROM eta_invoices e
         LEFT JOIN invoices i ON i.invoice_id = e.invoice_id
        WHERE e.invoice_id = $1::bigint ORDER BY e.eta_invoice_id DESC LIMIT 1`,
      [invoiceId],
    );
  }
}

@Controller('eta')
export class EtaController {
  constructor(private readonly service: EtaService) {}

  @RequirePermissions('settings.manage')
  @Get('status')
  status() {
    return this.service.status();
  }

  @RequirePermissions('settings.manage')
  @Get('config')
  config() {
    return this.service.getConfig();
  }

  @RequirePermissions('settings.manage')
  @Put('config')
  saveConfig(@Body() body: any) {
    return this.service.saveConfig(body);
  }

  @RequirePermissions('sales.view')
  @Get('invoices')
  list(@Query('limit') limit: string) {
    return this.service.list(Math.min(Number(limit) || 50, 500));
  }

  @RequirePermissions('sales.view')
  @Get('invoices/:invoiceId')
  getDocument(@Param('invoiceId', ParseIntPipe) invoiceId: number) {
    return this.service.getDocument(invoiceId);
  }

  @RequirePermissions('sales.manage')
  @Post('invoices/:invoiceId/generate')
  generate(@Param('invoiceId', ParseIntPipe) invoiceId: number, @Body() body: any) {
    return this.service.generate(invoiceId, body ?? {});
  }

  @RequirePermissions('sales.manage')
  @Post('invoices/:invoiceId/submit')
  submit(@Param('invoiceId', ParseIntPipe) invoiceId: number) {
    return this.service.submit(invoiceId);
  }
}

@Module({
  controllers: [EtaController],
  providers: [EtaService],
  exports: [EtaService],
})
export class EtaModule {}
