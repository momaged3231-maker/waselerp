/**
 * UBL 2.1 invoice XML for the Egyptian Tax Authority (ETA).
 *
 * The structure follows the Egyptian e-invoicing specification: UBL 2.1 with the
 * "ICV" additional document reference carrying the internal UUID, EGP as the
 * document currency and the EG country sub-entity.
 *
 * The output is deterministic: the same input always yields byte-identical XML,
 * which is what the invoice hash (and therefore the QR) is computed over.
 */
export interface EtaInvoiceLine {
  itemId?: number;
  name: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  taxPct: number;
  lineTotal: number;
  unitCode?: string;
}

export interface EtaInvoiceData {
  uuid: string;
  invoiceNumber: string;
  issueDate: string;          // ISO timestamp
  invoiceType: 1 | 2;         // 1 simplified, 2 standard
  seller: {
    name: string;
    vatNumber: string;
    address?: string;
    email?: string;
    phone?: string;
    registrationId?: string;
    logoBase64?: string | null;
  };
  buyer: {
    name: string;
    vatNumber?: string | null;
    address?: string;
    email?: string;
    phone?: string;
  };
  lines: EtaInvoiceLine[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  allowanceTotal: number;
  notes?: string;
}

const escape = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const money = (value: number) => Number(value ?? 0).toFixed(2);

export function buildEtaInvoiceXml(data: EtaInvoiceData, signature?: {
  certificateBase64: string;
  signatureValueBase64: string;
  hashBase64: string;
}): string {
  const issueDate = data.issueDate.replace(/[-:]/g, '').replace(/\.\d+/, '');
  const taxTotal = data.taxAmount;
  const allowance = data.allowanceTotal || data.discountAmount;

  const lines = data.lines.map((line, index) => `
        <cac:InvoiceLine>
          <cbc:ID>${index + 1}</cbc:ID>
          <cbc:InvoicedQuantity unitCode="${escape(line.unitCode ?? 'EA')}">${Number(line.quantity).toFixed(6)}</cbc:InvoicedQuantity>
          <cbc:LineExtensionAmount currencyID="EGP">${money(line.lineTotal)}</cbc:LineExtensionAmount>
          ${line.itemId ? `<cac:Item><cbc:Name>${escape(line.name)}</cbc:Name></cac:Item>` : ''}
          <cac:Price>
            <cbc:PriceAmount currencyID="EGP">${money(line.unitPrice)}</cbc:PriceAmount>
          </cac:Price>
        </cac:InvoiceLine>`).join('');

  const taxSubtotal = data.lines.map((line) => `
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="EGP">${money(line.quantity * line.unitPrice - line.discountAmount)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="EGP">${money(line.taxAmount)}</cbc:TaxAmount>
          <cac:TaxCategory>
            <cbc:ID>S</cbc:ID>
            <cbc:Percent>${Number(line.taxPct).toFixed(2)}</cbc:Percent>
            <cac:TaxScheme>
              <cbc:ID schemeID="UN/ECE 5305" schemeAgencyID="6">S</cbc:ID>
            </cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>`).join('');

  const signatureBlock = signature ? `
      <ext:UBLExtensions>
        <ext:UBLExtension>
          <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades.InvoiceSignatureType</ext:ExtensionURI>
          <ext:ExtensionContent>
            <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:sig:1.0" xmlns:sac="urn:oasis:names:specification:ubl:sig:enveloped:xades" xmlns:sbc="urn:oasis:names:specification:ubl:sig:enveloped:xades">
              <sig:Signature>
                <sig:ID>urn:oasis:names:specification:ubl:signature:Invoice</sig:ID>
                <sig:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
                <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
                  <ds:SignedInfo>
                    <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
                    <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
                    <ds:Reference URI="#_invoiceXMLSignature">
                      <ds:Transforms>
                        <ds:Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
                      </ds:Transforms>
                      <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmlenc#sha256"/>
                      <ds:DigestValue>${escape(signature.hashBase64)}</ds:DigestValue>
                    </ds:Reference>
                  </ds:SignedInfo>
                  <ds:SignatureValue>${escape(signature.signatureValueBase64)}</ds:SignatureValue>
                  <ds:KeyInfo>
                    <ds:X509Data>
                      <ds:X509Certificate>${escape(signature.certificateBase64)}</ds:X509Certificate>
                    </ds:X509Data>
                  </ds:KeyInfo>
                </ds:Signature>
              </sig:Signature>
            </sig:UBLDocumentSignatures>
          </ext:ExtensionContent>
        </ext:UBLExtension>
      </ext:UBLExtensions>` : '';

  const buyerVat = data.buyer.vatNumber
    ? `<cac:PartyTaxScheme><cbc:CompanyID>${escape(data.buyer.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID schemeID="UN/ECE 5305" schemeAgencyID="6">S</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
    : '';

  const logo = data.seller.logoBase64
    ? `<cac:AdditionalDocumentReference><cbc:ID>Logo</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/png">${data.seller.logoBase64}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades.InvoiceSignatureType</ext:ExtensionURI>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escape(data.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${escape(data.uuid)}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueDate}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${data.invoiceType === 1 ? '388' : '010'}">${data.invoiceType === 1 ? '388' : '010'}</cbc:InvoiceTypeCode>
  <cbc:Note languageID="ar">${escape(data.notes ?? '')}</cbc:Note>
  <cbc:DocumentCurrencyCode>EGP</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>EGP</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${escape(data.uuid)}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  ${logo}
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escape(data.notes ?? '')}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="CRN">${escape(data.seller.registrationId ?? data.seller.vatNumber)}</cbc:ID></cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${escape(data.seller.address ?? '')}</cbc:StreetName>
        <cbc:CitySubdivisionName>${escape(data.seller.address ?? '')}</cbc:CitySubdivisionName>
        <cbc:CountrySubentity>EG</cbc:CountrySubentity>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escape(data.seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID schemeID="UN/ECE 5305" schemeAgencyID="6">S</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escape(data.seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${buyerVat}
      <cac:PostalAddress>
        <cbc:StreetName>${escape(data.buyer.address ?? '')}</cbc:StreetName>
        <cbc:CitySubdivisionName>${escape(data.buyer.address ?? '')}</cbc:CitySubdivisionName>
        <cbc:CountrySubentity>EG</cbc:CountrySubentity>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escape(data.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EGP">${money(taxTotal)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EGP">${money(data.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EGP">${money(data.totalAmount - taxTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EGP">${money(data.totalAmount)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="EGP">${money(allowance)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="EGP">${money(data.totalAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lines}
  ${taxSubtotal}
</Invoice>`;
}
