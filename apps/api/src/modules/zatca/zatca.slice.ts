import {
  Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/security';
import { buildInvoiceXml, ZatcaInvoiceLine } from './zatca-xml';
import {
  buildQrPayload, buildSimplifiedQrPayload, computeCryptographicStamp, qrToPngBase64, ZatcaConfigRow,
} from './zatca-qr';

const ENDPOINTS: Record<string, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
};

@Injectable()
export class ZatcaService {
  constructor(private readonly db: DatabaseService) {}

  async getConfig(): Promise<ZatcaConfigRow | null> {
    return this.db.one<ZatcaConfigRow>('SELECT * FROM zatca_config ORDER BY config_id LIMIT 1');
  }

  async saveConfig(body: any): Promise<ZatcaConfigRow> {
    const current = await this.getConfig();
    // The admin screen sends the raw row (snake_case); the API is camelCase.
    const pick = (camel: string, snake: string) => body[camel] ?? body[snake];
    const values = {
      seller_name: pick('sellerName', 'seller_name') ?? current?.seller_name ?? '',
      seller_vat_number: pick('vatNumber', 'seller_vat_number') ?? current?.seller_vat_number ?? '',
      seller_address: pick('address', 'seller_address') ?? current?.seller_address ?? null,
      seller_email: pick('email', 'seller_email') ?? current?.seller_email ?? null,
      seller_phone: pick('phone', 'seller_phone') ?? current?.seller_phone ?? null,
      seller_logo: pick('logoBase64', 'seller_logo') ?? current?.seller_logo ?? null,
      environment: pick('environment', 'environment') ?? current?.environment ?? 'sandbox',
      csid_token: pick('csidToken', 'csid_token') ?? current?.csid_token ?? null,
      csid_secret: pick('csidSecret', 'csid_secret') ?? current?.csid_secret ?? null,
      private_key: pick('privateKey', 'private_key') ?? current?.private_key ?? null,
      certificate: pick('certificate', 'certificate') ?? current?.certificate ?? null,
      ecdsa_private_key: pick('ecdsaPrivateKey', 'ecdsa_private_key') ?? current?.ecdsa_private_key ?? null,
      ecdsa_public_key: pick('ecdsaPublicKey', 'ecdsa_public_key') ?? current?.ecdsa_public_key ?? null,
      is_active: pick('isActive', 'is_active') ?? current?.is_active ?? false,
    };

    if (current) {
      await this.db.query(
        `UPDATE zatca_config SET seller_name=$2, seller_vat_number=$3, seller_address=$4, seller_email=$5,
                seller_phone=$6, seller_logo=$7, environment=$8, csid_token=$9, csid_secret=$10, private_key=$11,
                certificate=$12, ecdsa_private_key=$13, ecdsa_public_key=$14, is_active=$15, updated_at=now()
          WHERE config_id=$1`,
        [current.config_id, ...Object.values(values)],
      );
    } else {
      await this.db.query(
        `INSERT INTO zatca_config (seller_name, seller_vat_number, seller_address, seller_email, seller_phone,
                seller_logo, environment, csid_token, csid_secret, private_key, certificate, ecdsa_private_key,
                ecdsa_public_key, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        Object.values(values),
      );
    }
    return (await this.getConfig())!;
  }

  async status() {
    const config = await this.getConfig();
    const invoices = await this.db.query(
      `SELECT status, COUNT(*)::int AS count FROM zatca_invoices GROUP BY status`,
    );
    return {
      configured: !!config?.is_active && !!config?.private_key,
      environment: config?.environment ?? 'sandbox',
      sellerName: config?.seller_name ?? null,
      vatNumber: config?.seller_vat_number ?? null,
      hasCsid: !!config?.csid_secret,
      hasCertificate: !!config?.certificate,
      hasEcdsaKey: !!config?.ecdsa_private_key,
      invoiceCounts: invoices,
    };
  }

  /** Builds, signs and stores the ZATCA document for an invoice. */
  async generate(invoiceId: number, body: { invoiceType?: 1 | 2 } = {}) {
    const config = await this.getConfig();
    if (!config) throw new BadRequestException('إعدادات ZATCA غير مهيأة');

    const invoice = await this.db.one<any>(
      `SELECT i.*, p.name AS party_name, p.tax_number AS party_tax_number, p.address AS party_address,
              p.email AS party_email, p.phone AS party_phone, b.name AS branch_name
         FROM invoices i LEFT JOIN parties p ON p.party_id = i.party_id
         LEFT JOIN branches b ON b.branch_id = i.branch_id
        WHERE i.invoice_id = $1`,
      [invoiceId],
    );
    if (!invoice) throw new BadRequestException('الفاتورة غير موجودة');

    const lines = await this.db.query<any>(
      `SELECT l.*, it.name AS item_name, it.code AS item_code, u.name AS unit_name
         FROM invoice_lines l JOIN items it ON it.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.invoice_id = $1 ORDER BY l.line_number`,
      [invoiceId],
    );

    const invoiceType = body.invoiceType ?? 2;
    const uuid = randomUUID();

    const mapped: ZatcaInvoiceLine[] = lines.map((line) => ({
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
      invoiceType,
      seller: {
        name: config.seller_name ?? 'WaselERP',
        vatNumber: config.seller_vat_number ?? '',
        address: config.seller_address ?? '',
        email: config.seller_email ?? '',
        phone: config.seller_phone ?? '',
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
      totalVatAmount: Number(invoice.tax_amount),
      allowanceTotal: Number(invoice.discount_amount),
      notes: invoice.notes ?? '',
    };

    // 1. build XML without signature
    const plainXml = buildInvoiceXml(data);
    // 2. compute the cryptographic stamp over that XML
    const stamp = computeCryptographicStamp(plainXml, config);
    // 3. embed the signature into the XML (standard invoices only)
    const certificateBase64 = (config.certificate ?? '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const xml = invoiceType === 2 && config.certificate
      ? buildInvoiceXml(data, {
        certificateBase64,
        signatureValueBase64: stamp.rsaSignature,
        hashBase64: stamp.invoiceHash,
      })
      : plainXml;

    // 4. QR payload
    const qrBuffer = invoiceType === 2
      ? buildQrPayload({
        sellerName: data.seller.name,
        vatNumber: data.seller.vatNumber,
        timestamp: data.issueDate,
        totalWithVat: data.totalAmount,
        vatTotal: data.taxAmount,
        invoiceHash: stamp.invoiceHash,
        ecdsaSignature: stamp.ecdsaSignature,
        ecdsaPublicKey: stamp.ecdsaPublicKey,
        rsaSignature: stamp.rsaSignature,
      })
      : buildSimplifiedQrPayload({
        sellerName: data.seller.name,
        vatNumber: data.seller.vatNumber,
        timestamp: data.issueDate,
        totalWithVat: data.totalAmount,
        vatTotal: data.taxAmount,
        invoiceHash: stamp.invoiceHash,
      });

    const qrPng = await qrToPngBase64(qrBuffer);

    const saved = await this.db.one<any>(
      `INSERT INTO zatca_invoices (invoice_id, invoice_uuid, invoice_type, xml, qr_data, qr_png_base64,
              invoice_hash, ecdsa_signature, rsa_signature, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
       ON CONFLICT (invoice_uuid) DO UPDATE SET
         xml = EXCLUDED.xml, qr_data = EXCLUDED.qr_data, qr_png_base64 = EXCLUDED.qr_png_base64,
         invoice_hash = EXCLUDED.invoice_hash
       RETURNING zatca_invoice_id AS "zatcaInvoiceId", invoice_uuid AS "invoiceUuid", invoice_hash AS "invoiceHash"`,
      [invoiceId, uuid, invoiceType, xml, qrBuffer.toString('base64'), qrPng, stamp.invoiceHash,
        stamp.ecdsaSignature, stamp.rsaSignature],
    );

    return {
      zatcaInvoiceId: saved.zatca_invoice_id,
      uuid,
      invoiceHash: stamp.invoiceHash,
      xml,
      qrPngBase64: qrPng,
      qrDataBase64: qrBuffer.toString('base64'),
      signed: !!stamp.ecdsaSignature,
      status: 'pending',
    };
  }

  /** Sends the document to ZATCA (clearance for standard, reporting for simplified). */
  async submit(invoiceId: number) {
    const config = await this.getConfig();
    if (!config?.csid_secret || !config?.certificate) {
      throw new BadRequestException('بيانات CSID غير مكتملة — سجّل الدخول في بوابة ZATCA أولاً');
    }
    const document = await this.db.one<any>(
      'SELECT * FROM zatca_invoices WHERE invoice_id = $1 ORDER BY zatca_invoice_id DESC LIMIT 1',
      [invoiceId],
    );
    if (!document) throw new BadRequestException('لم يتم توليد المستند بعد');

    const isStandard = Number(document.invoice_type) === 2;
    const path = isStandard ? '/invoices/clearance' : '/invoices/reporting';
    const base = ENDPOINTS[config.environment] ?? ENDPOINTS.sandbox;

    const authorization = Buffer.from(`${config.certificate}:${config.csid_secret}`).toString('base64');
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Version': 'V2',
        'Accept-Language': 'en',
        Authorization: `Basic ${authorization}`,
        'Clearance-Status': isStandard ? '1' : '0',
        'Invoice-Transaction-Id': document.invoice_uuid,
      },
      body: JSON.stringify({
        invoiceHash: document.invoice_hash,
        uuid: document.invoice_uuid,
        invoice: Buffer.from(document.xml, 'utf8').toString('base64'),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    const ok = response.ok && !payload.validationResults?.errorMessages?.length;

    await this.db.query(
      `UPDATE zatca_invoices SET status = $2, zatca_response = $3::jsonb, cleared_at = CASE WHEN $4 THEN now() ELSE cleared_at END
        WHERE zatca_invoice_id = $1`,
      [document.zatca_invoice_id, ok ? (isStandard ? 2 : 3) : 4, JSON.stringify(payload), ok],
    );

    return { ok, status: response.status, response: payload };
  }

  async list(limit = 50) {
    return this.db.query(
      `SELECT z.zatca_invoice_id AS "zatcaInvoiceId", z.invoice_uuid AS "invoiceUuid", z.invoice_type AS "invoiceType",
              z.status, z.invoice_hash AS "invoiceHash", z.created_at AS "createdAt", z.cleared_at AS "clearedAt",
              i.invoice_no AS "invoiceNo", i.total_amount AS "totalAmount", i.invoice_date AS "invoiceDate"
         FROM zatca_invoices z LEFT JOIN invoices i ON i.invoice_id = z.invoice_id
        ORDER BY z.zatca_invoice_id DESC LIMIT $1`,
      [limit],
    );
  }

  async getDocument(invoiceId: number) {
    return this.db.one<any>(
      `SELECT z.*, i.invoice_no AS "invoiceNo" FROM zatca_invoices z
        LEFT JOIN invoices i ON i.invoice_id = z.invoice_id
       WHERE z.invoice_id = $1 ORDER BY z.zatca_invoice_id DESC LIMIT 1`,
      [invoiceId],
    );
  }
}

@Controller('zatca')
export class ZatcaController {
  constructor(private readonly service: ZatcaService) {}

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

  @RequirePermissions('settings.manage')
  @Get('invoices')
  list() {
    return this.service.list();
  }

  @RequirePermissions('sales.manage')
  @Get('invoices/:invoiceId')
  document(@Param('invoiceId', ParseIntPipe) invoiceId: number) {
    return this.service.getDocument(invoiceId);
  }

  @RequirePermissions('sales.manage')
  @Post('invoices/:invoiceId/generate')
  generate(@Param('invoiceId', ParseIntPipe) invoiceId: number, @Body() body: { invoiceType?: 1 | 2 }) {
    return this.service.generate(invoiceId, body ?? {});
  }

  @RequirePermissions('sales.manage')
  @Post('invoices/:invoiceId/submit')
  submit(@Param('invoiceId', ParseIntPipe) invoiceId: number) {
    return this.service.submit(invoiceId);
  }
}

@Module({
  controllers: [ZatcaController],
  providers: [ZatcaService],
  exports: [ZatcaService],
})
export class ZatcaModule {}
