// MediBill history: who built what, when, and the bugs fixed along the way (each fix is the commit of its ticket).
// Tickets CUP_BIL-3xx are seeded in Jira by demo/seed-jira.mjs --app medibill (demo/src/medibill/tickets.json).
//
// The open demo ticket is not in this history: the visit import (CUP_BIL-304, June) charges every MediAgenda booking of
// the day. In September MediAgenda added cancellations (CUP_DEMO-2533, status ANNULLATA), so a cancelled visit is
// charged too. It is created live with demo/new-ticket.mjs --scenario bil-cancelled.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, H, T, cutter } from '../../lib/history.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cut = cutter(join(HERE, 'template'));

export const TITLE = 'MediBill';
export const NEXT = `  node demo/run-mediagenda.mjs --project BIL     # backend :8083 + frontend :4203 (MediAgenda :8080, MediLab :8081)
  node demo/new-ticket.mjs --scenario bil-cancelled  # the demo ticket (a cancelled visit is charged)`;

export const PEOPLE = {
  roberto: ['Roberto Ferri', 'roberto.ferri@example.com'],
  chiara: ['Chiara Marchetti', 'chiara.marchetti@example.com'],
  matteo: ['Matteo Vitale', 'matteo.vitale@example.com'],
  // The same person as in MediAgenda: he knows its booking API and wrote the visit import.
  davide: ['Davide Greco', 'davide.greco@example.com'],
  bojan: ['Bojan Mijatović', '256592520+Bojan-Mijatovic@users.noreply.github.com'],
};

const BE = 'backend/src/main/java/com/medibill';
const TEST = 'backend/src/test/java/com/medibill';
const MIG = 'backend/src/main/resources/db/migration';
const FE = 'frontend/src/app';

const YML = 'backend/src/main/resources/application.yml';
const GEH = `${BE}/common/GlobalExceptionHandler.java`;
const H_BAD = cut(GEH, '    @ExceptionHandler(BadRequestException.class)', '    @ExceptionHandler(NotFoundException.class)');
const H_CONFLICT = cut(GEH, '    @ExceptionHandler(ConflictException.class)', '    @ExceptionHandler(PeerUnavailableException.class)');
const H_PEER = cut(GEH, '\n\n    @ExceptionHandler(PeerUnavailableException.class)', '\n}\n');
const MEDISUITE = cut(YML, '\n# The other applications', '\nlogging:');
const MEDILAB_URL = cut(YML, '  medilab:\n', '\nlogging:');

const ROUTES = `${FE}/app.routes.ts`;
const route = (path) => cut(ROUTES, `  {\n    path: '${path}',`, '  },\n') + '  },\n';
const R_ADD = route('addebiti');
const R_RIC = route('ricevute');
const R_ESE = route('esenzioni');
const R_REP = route('report');
const NAV = `${FE}/core/layout/sidenav.component.ts`;
const link = (path, label) => `      <a routerLink="/${path}" routerLinkActive="active">${label}</a>\n`;
const L_ADD = link('addebiti', 'Addebiti');
const L_RIC = link('ricevute', 'Ricevute');
const L_ESE = link('esenzioni', 'Esenzioni');
const L_REP = link('report', 'Report incassi');

const IMPORT = `${BE}/charge/ChargeImportService.java`;
const IMPORT_TEST = `${TEST}/charge/ChargeImportServiceTest.java`;
const RECEIPTS = `${BE}/receipt/ReceiptService.java`;
const RECEIPT_TEST = `${TEST}/receipt/ReceiptServiceTest.java`;
const DATES = `${FE}/shared/utils/dates.ts`;
const PICKER = `${FE}/shared/components/patient-picker/patient-picker.component.ts`;
const CHARGES_FE = `${FE}/features/charges/charges.component.ts`;
const RECEIPTS_FE = `${FE}/features/receipts/receipts.component.ts`;

const testBetween = (file, name, next) => [cut(file, `    @Test\n    void ${name}`, `    @Test\n    void ${next}`), ''];
const lastTest = (file, name) => [cut(file, `\n\n    @Test\n    void ${name}`, '\n}\n'), ''];

// The co-pay computation of a receipt, in its three versions.
const COMPUTE = cut(RECEIPTS, '        Set<String> usedExemptions = new TreeSet<>();', '\n        LocalDateTime now = LocalDateTime.now();');
const DOUBLES = `        Set<String> usedExemptions = new TreeSet<>();
        double totalSum = 0;
        double exemptSum = 0;
        for (Charge c : open) {
            totalSum += c.getAmount().doubleValue();
            Exemption cover = coverOf(c);
            if (cover != null) {
                exemptSum += c.getAmount().doubleValue();
                usedExemptions.add(cover.getCode());
            }
        }
        BigDecimal total = BigDecimal.valueOf(totalSum);
        BigDecimal exempt = BigDecimal.valueOf(exemptSum);
        BigDecimal copay = BigDecimal.valueOf(Math.min(totalSum - exemptSum, CAP.doubleValue()));`;
const DOUBLES_PER_LINE = `        Set<String> usedExemptions = new TreeSet<>();
        double totalSum = 0;
        double exemptSum = 0;
        double copaySum = 0;
        for (Charge c : open) {
            totalSum += c.getAmount().doubleValue();
            Exemption cover = coverOf(c);
            if (cover != null) {
                exemptSum += c.getAmount().doubleValue();
                usedExemptions.add(cover.getCode());
            } else {
                copaySum += Math.min(c.getAmount().doubleValue(), CAP.doubleValue());
            }
        }
        BigDecimal total = BigDecimal.valueOf(totalSum);
        BigDecimal exempt = BigDecimal.valueOf(exemptSum);
        BigDecimal copay = BigDecimal.valueOf(copaySum);`;

const BUG = {
  // CUP_BIL-305: importing a day twice charged its visits twice
  dedupe: ['            if (charges.existsBySourceAndSourceRef(VISITA, b.id())) {\n                already++;\n                continue;\n            }\n', ''],
  dedupeDoc: [' Importing a day twice adds\n * nothing: every charge remembers its source.', ''],
  dedupeRepo: ['    boolean existsBySourceAndSourceRef(String source, String sourceRef);\n\n', ''],
  dedupeTest: testBetween(IMPORT_TEST, 'importingADayTwiceChargesOnce', 'importsTheTestsReportedInMediLab'),
  // CUP_BIL-306: "Ieri" used toISOString (UTC): after midnight it gave the day before yesterday
  utcHeader: ["// Calendar days as the office means them: in the browser's time zone (Europe/Rome), never in UTC.\n\n", ''],
  utcLocal: [cut(DATES, '/** The local calendar day', '/** Today, `offset` days later'), ''],
  utcDay: ['  return localIsoDate(d);', '  return d.toISOString().slice(0, 10);'],
  // CUP_BIL-308: the 36,15 € cap was applied to each service instead of the receipt
  capDoc: [' at most CAP per receipt.', ' at most CAP per service.'],
  capConstDoc: ['/** The regional maximum co-pay of a receipt (euro). */', '/** The regional maximum co-pay of a service (euro). */'],
  capTest: testBetween(RECEIPT_TEST, 'theCopayOfAReceiptIsCapped', 'amountsAreExactToTheCent'),
  // CUP_BIL-309: Ricevute showed 22.5 instead of 22,50 €
  money: [['{{ money(r.total) }}', '{{ r.total }}'], ['{{ money(r.exempt) }}', '{{ r.exempt }}'], ['{{ money(r.copay) }}', '{{ r.copay }}'], ['{{ money(l.amount) }}', '{{ l.amount }}'],
    ['`${done.id} pagata: ${formatMoney(done.copay)}`', '`${done.id} pagata: ${done.copay}`']],
  // CUP_BIL-310: an expired exemption still made the services free
  validity: ['return exemptions.findByFiscalCodeIgnoreCase(fiscalCode).stream().filter(e -> e.validOn(day)).toList();', 'return exemptions.findByFiscalCodeIgnoreCase(fiscalCode);'],
  validityDoc: ['    /** The exemptions of a patient that are valid on `day` (the day of the service, not the day of the receipt). */', '    /** The exemptions of a patient. */'],
  expiredTest: testBetween(RECEIPT_TEST, 'anExpiredExemptionDoesNotApply', 'aTotalExemptionMakesTheReceiptFree'),
  // CUP_BIL-312: sums in double: 3,3899999999999997 € on the receipt
  centsTest: testBetween(RECEIPT_TEST, 'amountsAreExactToTheCent', 'aDiseaseExemptionCoversItsTariffsOnly'),
  diseaseTest: testBetween(RECEIPT_TEST, 'aDiseaseExemptionCoversItsTariffsOnly', 'anExpiredExemptionDoesNotApply'),
  // CUP_BIL-313: a MediLab test whose tariff is not in the fee schedule failed the whole import with 500
  noTariff: [cut(IMPORT, '                Optional<Tariff> tariff = tariffs.findById(exam.tariffCode())', '                tests++;'),
    '                Tariff tariff = tariffs.findById(exam.tariffCode()).orElseThrow();\n                charges.save(Charge.of(LABORATORIO, ref, day, order.fiscalCode(), order.patientName(), tariff));\n'],
  noTariffTest: lastTest(IMPORT_TEST, 'aTestWithoutTariffIsSkippedNotFailed'),
  // CUP_BIL-314: a paid receipt could be cancelled (its charges opened again and were billed twice)
  storno: ['        if (!EMESSA.equals(status)) throw new ConflictException("status: only an unpaid receipt can be cancelled (" + id + " is " + status + ")");\n        status = STORNATA;', '        status = STORNATA;'],
  stornoDoc: [', or STORNATA (cancelled) while unpaid', ', or STORNATA (cancelled)'],
  stornoTest: ['\n        assertThatThrownBy(() -> service.storno("RC-2026-00041")).isInstanceOf(ConflictException.class);', ''],
  // CUP_BIL-316: the monthly report counted cancelled receipts
  report: ['                .filter(r -> !Receipt.STORNATA.equals(r.getStatus()))\n', ''],
  reportDoc: ['; cancelled (STORNATA) ones do not count', ''],
  // CUP_BIL-317: the patient picker was copied from MediLab before its fix CUP_LAB-119
  pickerReset: ['    // The text no longer names the chosen patient: the form must not keep sending the old patientId.\n    if (this.chosen) {\n      this.chosen = null;\n      this.picked.emit(null);\n    }\n', ''],
  pickerDoc: [' * Emits the chosen patient, and null as soon as the text no longer is that patient (edited or cleared).\n', ' * Emits the chosen patient.\n'],
  // CUP_BIL-318: monthOf used getMonth() (0-based): Report incassi opened on the previous month
  month: ["  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;", "  return `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`;"],
};

const LATER = {
  // CUP_BIL-304: bookings of MediAgenda
  bookingsIface: ['\n\n    /** Every MediAgenda booking, newest appointment first (GET /api/bookings). */\n    List<BookingInfo> bookings();', ''],
  bookingsIfaceDoc: [': its patient registry and the bookings (visits) to charge', ': its patient registry'],
  bookingsHttp: [cut(`${BE}/integration/HttpMediAgendaClient.java`, '\n\n    @Override\n    public List<BookingInfo> bookings()', '\n}\n'), ''],
  bookingsHttpImport: ['import java.util.Arrays;\n', ''],
  // CUP_BIL-311: tests reported in MediLab
  labLoop: [cut(IMPORT, '\n        // Tests reported that day in MediLab', '\n        return new ImportResult'), ''],
  labDoc: [" and the tests reported that day in MediLab (tariff by the test's tariff code)", ''],
  labImport1: ['import com.medibill.integration.LabOrderInfo;\n', ''],
  labImport2: ['import com.medibill.integration.MediLabClient;\n', ''],
  labField: ['    private final MediLabClient mediLab;\n', ''],
  labCtor: ['MediAgendaClient mediAgenda, MediLabClient mediLab) {', 'MediAgendaClient mediAgenda) {'],
  labAssign: ['        this.mediLab = mediLab;\n', ''],
  labTests: lastTest(IMPORT_TEST, 'importsTheTestsReportedInMediLab'),
  labFake: ['\n    @Autowired\n    FakeMediLabClient mediLab;\n\n    @AfterEach\n    void defaults() {\n        mediLab.reset();\n    }\n', ''],
  labFakeImports: ['import com.medibill.integration.FakeMediLabClient;\nimport com.medibill.integration.LabOrderInfo;\n', ''],
  labFakeImports2: ['import java.time.LocalDateTime;\n', ''],
  labFakeImports3: ['import org.junit.jupiter.api.AfterEach;\n', ''],
  // CUP_BIL-307: a charge goes on a receipt (charges.receipt_id comes with Flyway V4)
  receiptColumn: ['    @Column(name = "receipt_id")\n    private String receiptId;\n', ''],
  receiptMethods: ['    public void putOn(String receipt) {\n        status = IN_RICEVUTA;\n        receiptId = receipt;\n    }\n\n    public void release() {\n        status = APERTO;\n        receiptId = null;\n    }\n\n', ''],
  receiptGetter: ['    public String getReceiptId() { return receiptId; }\n', ''],
  receiptDoc: [' APERTO until it goes on a receipt.', ''],
  receiptRepo: ['\n    List<Charge> findByReceiptIdOrderByServiceDateAscIdAsc(String receiptId);\n', ''],
  // CUP_BIL-307: receipts from the Addebiti page
  issueButton: ['            <button type="button" class="btn-primary issue" (click)="issue(p.fiscalCode)">EMETTI RICEVUTA</button>\n', ''],
  issueImport: ["import { ReceiptApiService } from '../receipts/receipt-api.service';\n", ''],
  issueInject: ['  private readonly receipts = inject(ReceiptApiService);\n', ''],
  issueMethod: [cut(CHARGES_FE, '\n\n  issue(fiscalCode: string): void {', '\n}\n'), ''],
  // CUP_BIL-315: months for the report
  monthOf: [cut(DATES, '\n\n/** "2026-10" for the month of `date`', '\n\n/** "2026-10" moved by'), ''],
  addMonths: [cut(DATES, '\n\n/** "2026-10" moved by', '\n}\n') + '\n}', ''],
  ymlComment: ['(MediAgenda: patients and visits; MediLab: reported tests)', '(MediAgenda: patients and visits)'],
};
const NO_LAB_IMPORT = [LATER.labLoop, LATER.labDoc, LATER.labImport1, LATER.labImport2, LATER.labField, LATER.labCtor, LATER.labAssign];
const NO_LAB_TESTS = [LATER.labTests, LATER.labFake, LATER.labFakeImports, LATER.labFakeImports2, LATER.labFakeImports3];
const NO_DEDUPE = [BUG.dedupe, BUG.dedupeDoc];
const UTC_DATES = [BUG.utcHeader, BUG.utcLocal, BUG.utcDay];
const NO_MONTHS = [LATER.monthOf, LATER.addMonths];
const NO_ISSUE = [LATER.issueButton, LATER.issueImport, LATER.issueInject, LATER.issueMethod];

export const STEPS = [
  {
    who: 'roberto', date: '2026-04-06T10:00:00+02:00',
    message: 'CUP_BIL-301: backend skeleton and regional fee schedule (Flyway V1)\n\nGET /api/tariffs: the visits, each mapped to the MediAgenda provider (resource code) it is charged for.',
    files: {
      '.gitignore': T, 'README.md': H('01-backend'), 'backend/pom.xml': T, [YML]: B(T, [MEDISUITE, '']),
      [`${BE}/MediBillApplication.java`]: T, [`${BE}/common/ApiError.java`]: T, [`${BE}/common/NotFoundException.java`]: T,
      [GEH]: B(T, [H_BAD, ''], [H_CONFLICT, ''], [H_PEER, '']),
      [`${BE}/tariff/Tariff.java`]: T, [`${BE}/tariff/TariffRepository.java`]: T, [`${BE}/tariff/TariffController.java`]: T,
      [`${MIG}/V1__tariffs.sql`]: T,
    },
  },
  {
    who: 'chiara', date: '2026-04-13T15:30:00+02:00',
    message: 'CUP_BIL-302: frontend skeleton: app shell, layout and the Tariffario page',
    files: {
      'frontend/package.json': T, 'frontend/angular.json': T, 'frontend/tsconfig.json': T, 'frontend/tsconfig.app.json': T, 'frontend/proxy.conf.json': T,
      'frontend/src/index.html': T, 'frontend/src/main.ts': T, 'frontend/src/styles.scss': T,
      [`${FE}/app.config.ts`]: T, [`${FE}/app.component.ts`]: T,
      [ROUTES]: B(T, ["redirectTo: 'addebiti'", "redirectTo: 'tariffario'"], [R_ADD, ''], [R_RIC, ''], [R_ESE, ''], [R_REP, '']),
      [`${FE}/core/http/api.ts`]: T, [`${FE}/core/http/api-errors.ts`]: T, [`${FE}/core/i18n/labels.ts`]: T,
      [`${FE}/core/layout/header.component.ts`]: T, [NAV]: B(T, [L_ADD, ''], [L_RIC, ''], [L_ESE, ''], [L_REP, '']),
      [`${FE}/shared/models/bill.models.ts`]: T, [`${FE}/shared/utils/money.ts`]: T, [`${FE}/features/tariffs/tariffs.component.ts`]: T,
    },
  },
  {
    who: 'roberto', date: '2026-05-04T11:00:00+02:00',
    message: 'CUP_BIL-303: co-pay exemptions of MediAgenda patients (Flyway V2)\n\nPOST /api/exemptions for a MediAgenda patient (read from its registry): total exemptions, and disease exemptions\nthat cover only their tariff codes.',
    files: {
      [YML]: B(T, [MEDILAB_URL, ''], LATER.ymlComment), [`${BE}/common/BadRequestException.java`]: T, [`${BE}/common/PeerUnavailableException.java`]: T, [GEH]: B(T, [H_CONFLICT, '']),
      [`${BE}/integration/PatientInfo.java`]: T, [`${BE}/integration/MediAgendaClient.java`]: B(T, LATER.bookingsIface, LATER.bookingsIfaceDoc),
      [`${BE}/integration/HttpMediAgendaClient.java`]: B(T, LATER.bookingsHttp, LATER.bookingsHttpImport), [`${BE}/integration/PatientLookupController.java`]: T,
      [`${BE}/exemption/Exemption.java`]: T, [`${BE}/exemption/ExemptionType.java`]: T, [`${BE}/exemption/ExemptionRepository.java`]: T,
      [`${BE}/exemption/ExemptionRequest.java`]: T, [`${BE}/exemption/ExemptionService.java`]: B(T, BUG.validity, BUG.validityDoc), [`${BE}/exemption/ExemptionController.java`]: T,
      [`${MIG}/V2__exemptions.sql`]: T, [`${TEST}/integration/FakeMediAgendaClient.java`]: H('03-exemptions'),
    },
  },
  {
    who: 'chiara', date: '2026-05-08T16:20:00+02:00',
    message: 'CUP_BIL-303: Esenzioni page with the MediAgenda patient picker (the one of MediLab)',
    files: {
      [ROUTES]: B(T, ["redirectTo: 'addebiti'", "redirectTo: 'esenzioni'"], [R_ADD, ''], [R_RIC, ''], [R_REP, '']), [NAV]: B(T, [L_ADD, ''], [L_RIC, ''], [L_REP, '']),
      [`${FE}/shared/services/mediagenda-api.service.ts`]: T, [PICKER]: B(T, BUG.pickerReset, BUG.pickerDoc), [DATES]: B(T, ...UTC_DATES, ...NO_MONTHS),
      [`${FE}/features/exemptions/exemption-api.service.ts`]: T, [`${FE}/features/exemptions/exemptions.component.ts`]: T,
    },
  },
  {
    who: 'davide', date: '2026-06-02T10:30:00+02:00',
    message: 'CUP_BIL-304: daily import of the MediAgenda visits to charge (Flyway V3)\n\nPOST /api/charges/import?date= reads the MediAgenda bookings (GET /api/bookings) and charges each visit of that day\nat the tariff of its provider.',
    files: {
      [`${BE}/integration/MediAgendaClient.java`]: T, [`${BE}/integration/HttpMediAgendaClient.java`]: T, [`${BE}/integration/BookingInfo.java`]: T,
      [`${BE}/charge/Charge.java`]: B(T, LATER.receiptColumn, LATER.receiptMethods, LATER.receiptGetter, LATER.receiptDoc),
      [`${BE}/charge/ChargeRepository.java`]: B(T, BUG.dedupeRepo, LATER.receiptRepo), [`${BE}/charge/ImportResult.java`]: T,
      [IMPORT]: B(T, ...NO_DEDUPE, ...NO_LAB_IMPORT), [`${BE}/charge/ChargeController.java`]: T, [`${MIG}/V3__charges.sql`]: T,
      [`${TEST}/integration/FakeMediAgendaClient.java`]: T, [IMPORT_TEST]: B(T, BUG.dedupeTest, ...NO_LAB_TESTS),
    },
  },
  {
    who: 'chiara', date: '2026-06-05T14:00:00+02:00',
    message: 'CUP_BIL-304: Addebiti page: import of a day and the open charges by patient',
    files: {
      [ROUTES]: B(T, [R_RIC, ''], [R_REP, '']), [NAV]: B(T, [L_RIC, ''], [L_REP, '']),
      [`${FE}/features/charges/charge-api.service.ts`]: T, [CHARGES_FE]: B(T, ...NO_ISSUE),
    },
  },
  {
    who: 'davide', date: '2026-06-16T09:45:00+02:00',
    message: 'CUP_BIL-305: importing a day twice no longer charges its visits twice\n\nEvery charge remembers its source (booking id); a booking that is charged already is counted, not charged again.',
    files: { [IMPORT]: B(T, ...NO_LAB_IMPORT), [`${BE}/charge/ChargeRepository.java`]: B(T, LATER.receiptRepo), [IMPORT_TEST]: B(T, ...NO_LAB_TESTS) },
  },
  {
    who: 'chiara', date: '2026-06-22T11:15:00+02:00',
    message: 'CUP_BIL-306: Addebiti: Ieri and Oggi are the local days, not UTC\n\nDate.toISOString() is UTC: just after midnight "Ieri" gave the day before yesterday, and the wrong day was imported.',
    files: { [DATES]: B(T, ...NO_MONTHS) },
  },
  {
    who: 'matteo', date: '2026-06-29T10:00:00+02:00',
    message: 'CUP_BIL-307: receipts with co-pay and exemptions (Flyway V4)\n\nPOST /api/receipts puts every open charge of a patient on one receipt; exempt charges are free, the co-pay is\ncapped at 36,15 €. PAGA and STORNA (an unpaid receipt: its charges are open again).',
    files: {
      [`${BE}/common/ConflictException.java`]: T, [GEH]: T, [`${BE}/charge/Charge.java`]: T, [`${BE}/charge/ChargeRepository.java`]: T,
      [`${BE}/receipt/Receipt.java`]: B(T, BUG.storno, BUG.stornoDoc), [`${BE}/receipt/ReceiptRepository.java`]: T, [`${BE}/receipt/ReceiptView.java`]: T,
      [`${BE}/receipt/ReceiptRequest.java`]: T, [RECEIPTS]: B(T, [COMPUTE, DOUBLES_PER_LINE], BUG.capDoc, BUG.capConstDoc), [`${BE}/receipt/ReceiptController.java`]: T,
      [`${MIG}/V4__receipts.sql`]: T,
      [RECEIPT_TEST]: B(T, BUG.capTest, BUG.centsTest, BUG.diseaseTest, BUG.expiredTest, BUG.stornoTest),
    },
  },
  {
    who: 'chiara', date: '2026-07-03T15:40:00+02:00',
    message: 'CUP_BIL-307: Ricevute page, and EMETTI RICEVUTA on Addebiti',
    files: {
      [ROUTES]: B(T, [R_REP, '']), [NAV]: B(T, [L_REP, '']),
      [`${FE}/features/receipts/receipt-api.service.ts`]: T, [RECEIPTS_FE]: B(T, ...BUG.money), [CHARGES_FE]: T,
    },
  },
  {
    who: 'matteo', date: '2026-07-14T10:20:00+02:00',
    message: 'CUP_BIL-308: the co-pay cap is per receipt, not per service\n\nEach line was capped at 36,15 € and the lines were added up: two visits of 22,50 € cost 45,00 € instead of 36,15 €.',
    files: { [RECEIPTS]: B(T, [COMPUTE, DOUBLES]), [RECEIPT_TEST]: B(T, BUG.centsTest, BUG.diseaseTest, BUG.expiredTest, BUG.stornoTest) },
  },
  {
    who: 'chiara', date: '2026-07-21T16:00:00+02:00',
    message: 'CUP_BIL-309: Ricevute shows amounts in euro with two decimals\n\nThe page printed 22.5 and 15.49; it uses formatMoney (shared/utils/money.ts) like the other pages now.',
    files: { [RECEIPTS_FE]: T },
  },
  {
    who: 'roberto', date: '2026-08-24T09:30:00+02:00',
    message: 'CUP_BIL-310: an expired exemption no longer makes services free\n\nThe validity dates were not checked: an exemption counts only if it is valid on the day of the service.',
    files: { [`${BE}/exemption/ExemptionService.java`]: T, [RECEIPT_TEST]: B(T, BUG.centsTest, BUG.diseaseTest, BUG.stornoTest) },
  },
  {
    who: 'matteo', date: '2026-09-14T11:10:00+02:00',
    message: 'CUP_BIL-311: daily import of the tests reported in MediLab (Flyway V5)\n\nReads GET /api/orders?status=REFERTATA&from=&to= of MediLab (CUP_LAB-116) and charges every test by its tariff\ncode. Laboratory tariffs added to the fee schedule.',
    files: {
      [YML]: T, [`${BE}/integration/LabOrderInfo.java`]: T, [`${BE}/integration/MediLabClient.java`]: T, [`${BE}/integration/HttpMediLabClient.java`]: T,
      [IMPORT]: B(T, BUG.noTariff), [`${MIG}/V5__lab_tariffs.sql`]: T,
      [`${TEST}/integration/FakeMediLabClient.java`]: T, [IMPORT_TEST]: B(T, BUG.noTariffTest),
    },
  },
  {
    who: 'matteo', date: '2026-09-22T14:30:00+02:00',
    message: 'CUP_BIL-312: receipt amounts are exact to the cent\n\nThe sums were computed in double: three tests of 1,13 € made a co-pay of 3,3899999999999997 €. BigDecimal now.',
    files: { [RECEIPTS]: T, [RECEIPT_TEST]: B(T, BUG.stornoTest) },
  },
  {
    who: 'matteo', date: '2026-09-29T10:00:00+02:00',
    message: 'CUP_BIL-313: a test without a tariff is skipped instead of failing the import\n\nOne MediLab test whose tariff code is not in the fee schedule ended the whole import with error 500.\nIt is reported under "skipped" now.',
    files: { [IMPORT]: T, [IMPORT_TEST]: T },
  },
  {
    who: 'roberto', date: '2026-10-05T11:45:00+02:00',
    message: 'CUP_BIL-314: a paid receipt can no longer be cancelled',
    files: { [`${BE}/receipt/Receipt.java`]: T, [RECEIPT_TEST]: T },
  },
  {
    who: 'roberto', date: '2026-10-12T10:10:00+02:00',
    message: 'CUP_BIL-315: monthly report of receipts and co-pay\n\nGET /api/reports/monthly?month=2026-10: receipts issued in the month, total, exempt part, co-pay issued and collected.',
    files: { [`${BE}/report/MonthlyReport.java`]: T, [`${BE}/report/ReportController.java`]: B(T, BUG.report, BUG.reportDoc) },
  },
  {
    who: 'chiara', date: '2026-10-14T15:20:00+02:00',
    message: 'CUP_BIL-315: Report incassi page',
    files: { [ROUTES]: T, [NAV]: T, [`${FE}/features/reports/report.component.ts`]: T, [DATES]: B(T, BUG.month) },
  },
  {
    who: 'roberto', date: '2026-10-19T09:00:00+02:00',
    message: 'CUP_BIL-316: the monthly report leaves out cancelled receipts',
    files: { [`${BE}/report/ReportController.java`]: T, [`${TEST}/report/ReportControllerTest.java`]: T },
  },
  {
    who: 'chiara', date: '2026-10-26T11:30:00+01:00',
    message: 'CUP_BIL-317: Esenzioni: editing the patient after picking forgets the picked patient\n\nThe patient picker was copied from MediLab before its fix (CUP_LAB-119); the same fix here.',
    files: { [PICKER]: T },
  },
  {
    who: 'chiara', date: '2026-11-02T10:00:00+01:00',
    message: 'CUP_BIL-318: Report incassi opens on the current month\n\nmonthOf() used getMonth() (0 = January): in November the page showed October.',
    files: { [DATES]: T },
  },
  {
    who: 'bojan', date: '2026-11-04T19:10:00+01:00',
    message: 'Browser tests: Playwright with a mocked backend API (import, receipts, exemptions, report)',
    files: {
      'README.md': T, 'e2e/package.json': T, 'e2e/playwright.config.ts': T, 'e2e/README.md': T,
      'e2e/support/evidence.ts': T, 'e2e/support/api-data.json': T, 'e2e/support/mock-api.ts': T, 'e2e/support/bill.ts': T,
      'e2e/tests/charges.smoke.spec.ts': T, 'e2e/tests/receipts.smoke.spec.ts': T,
    },
  },
];
