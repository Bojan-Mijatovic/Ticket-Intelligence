// MediLab history: who built what, when, and the bugs fixed along the way (each fix is the commit of its ticket).
// Tickets CUP_LAB-1xx are seeded in Jira by demo/seed-jira.mjs --app medilab (demo/src/medilab/tickets.json).
//
// The open demo ticket is not in this history: the comma bug introduced by CUP_LAB-120 (Inserimento risultati:
// "1,35" is saved as 1) is created live with demo/new-ticket.mjs --scenario lab-decimal.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, H, T, cutter } from '../../lib/history.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cut = cutter(join(HERE, 'template'));

export const TITLE = 'MediLab';
export const NEXT = `  node demo/run-mediagenda.mjs --project LAB     # backend :8081 + frontend :4201 (MediAgenda on :8080 for patients)
  node demo/new-ticket.mjs --scenario lab-decimal  # the demo ticket (decimal comma in Inserimento risultati)`;

export const PEOPLE = {
  giorgio: ['Giorgio Esposito', 'giorgio.esposito@example.com'],
  alessandro: ['Alessandro Moretti', 'alessandro.moretti@example.com'],
  francesca: ['Francesca Lombardi', 'francesca.lombardi@example.com'],
  // The same person as in MediAgenda: he built the MediAgenda patient API and MediLab's client of it.
  luca: ['Luca Bianchi', 'luca.bianchi@example.com'],
  bojan: ['Bojan Mijatović', '256592520+Bojan-Mijatovic@users.noreply.github.com'],
};

const BE = 'backend/src/main/java/com/medilab';
const TEST = 'backend/src/test/java/com/medilab';
const MIG = 'backend/src/main/resources/db/migration';
const FE = 'frontend/src/app';

// ---------------------------------------------------------------- texts removed or changed in older versions

const YML = 'backend/src/main/resources/application.yml';
const GEH = `${BE}/common/GlobalExceptionHandler.java`;
const H_BAD = cut(GEH, '    @ExceptionHandler(BadRequestException.class)', '    @ExceptionHandler(NotFoundException.class)');
const H_CONFLICT = cut(GEH, '    @ExceptionHandler(ConflictException.class)', '    @ExceptionHandler(PeerUnavailableException.class)');
const H_PEER = cut(GEH, '\n\n    @ExceptionHandler(PeerUnavailableException.class)', '\n}\n');
const MEDISUITE = cut(YML, '\n# The other applications', '\nlogging:');

const ROUTES = `${FE}/app.routes.ts`;
const route = (path) => cut(ROUTES, `  {\n    path: '${path}',`, '  },\n') + '  },\n';
const R_LIST = route('richieste');
const R_NEW = route('richieste/nuova');
const R_SAMPLES = route('campioni');
const R_RESULTS = route('richieste/:id/risultati');
const R_REPORT = route('referti/:id');
const NAV = `${FE}/core/layout/sidenav.component.ts`;
const L_LIST = '      <a routerLink="/richieste" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Richieste</a>\n';
const L_NEW = '      <a routerLink="/richieste/nuova" routerLinkActive="active">Nuova richiesta</a>\n';
const L_SAMPLES = '      <a routerLink="/campioni" routerLinkActive="active">Accettazione campioni</a>\n';

const BUG = {
  // CUP_LAB-103: a test in a profile and ticked by hand is sent twice; the duplicate key fails the request with 500
  twice: ['        // The same test can come from a profile and be ticked by hand as well: it is done (and charged) once.\n        List<String> codes = request.examCodes().stream().map(c -> c.trim().toUpperCase(Locale.ROOT)).distinct().toList();',
    '        List<String> codes = request.examCodes().stream().map(c -> c.trim().toUpperCase(Locale.ROOT)).toList();'],
  twiceTest: [cut(`${TEST}/order/OrderServiceTest.java`, '    @Test\n    void aTestChosenTwiceIsDoneOnce', '    @Test\n    void rejectsAPatientThatIsNotInMediAgenda'), ''],
  // CUP_LAB-104: "Tutte" had the value TUTTE, sent as a status: the list was empty until a status was chosen
  allValue: ['          <option value="">Tutte</option>', '          <option value="TUTTE">Tutte</option>'],
  allDefault: ["  status = '';", "  status = 'TUTTE';"],
  // CUP_LAB-106: a barcode typed (or scanned) in lower case was not found
  upper: ['    // Labels are printed in upper case; a scanner with Caps Lock off, or a code typed by hand, may send lower case.\n    const code = this.barcode.trim().toUpperCase();',
    '    const code = this.barcode.trim();'],
  // CUP_LAB-108: the range for women was chosen with "FEMALE", but MediAgenda sends "F": everyone got the male range
  female: ['        // MediAgenda registers the sex as "M" or "F" (its PatientRequest); the order keeps that copy.\n        boolean female = "F".equalsIgnoreCase(sex);',
    '        boolean female = "FEMALE".equalsIgnoreCase(sex);'],
  // CUP_LAB-109: cancelling a request left its tubes ATTESO, and accepting did not check the request
  cancelTubes: ['        samples.findByOrderIdOrderByBarcodeAsc(id).forEach(Sample::cancel);\n', ''],
  cancelTubesTest: [cut(`${TEST}/order/OrderServiceTest.java`, '    @Test\n    void cancelsAWaitingRequestAndItsTubes', '    @Test\n    void aRequestInWorkCannotBeCancelled'),
    '    @Test\n    void cancelsAWaitingRequest() {\n        OrderView o = service.cancel("RL-2026-00061", new CancelRequest("Paziente non presentato"));\n        assertThat(o.status()).isEqualTo(OrderStatus.ANNULLATA);\n    }\n\n'],
  openCheck: ['        if (!order.isOpen()) {\n            throw new ConflictException("status: request " + order.getId() + " is " + order.getStatus() + ", its samples cannot be accepted");\n        }\n', ''],
  openCheckTest: [cut(`${TEST}/sample/SampleServiceTest.java`, '    @Test\n    void aTubeOfACancelledRequestCannotBeAccepted', '    @Test\n    void aRejectedTubeIsReplacedByANewOne'), ''],
  openCheckTestImports: ['import com.medilab.order.CancelRequest;\nimport com.medilab.order.OrderService;\n', ''],
  openCheckTestField: ['    @Autowired\n    OrderService orders;\n\n', ''],
  // CUP_LAB-110: the URGENTE checkbox was never sent
  urgent: ['urgent: v.urgent,', 'urgent: false,'],
  // CUP_LAB-111: a request could be validated with tests that had no value
  missing: [cut(`${BE}/result/ResultService.java`, '        List<String> missing = order.getExamCodes()', '        LocalDateTime now = LocalDateTime.now();\n        list.forEach'), ''],
  missingDoc: ['    /** Validation: every test needs a value; then the request is REFERTATA and the report can be printed. */', '    /** Validation: the request is REFERTATA and the report can be printed. */'],
  // CUP_LAB-112: a rejected tube was not replaced, so the request waited forever for a tube that would never come
  replaceField: ['    @Column(name = "replaced_by")\n    private String replacedBy;\n', ''],
  replaceMethod: ['    void replaceWith(String newBarcode) {\n        replacedBy = newBarcode;\n    }\n\n', ''],
  replaceGetter: ['    public String getReplacedBy() { return replacedBy; }\n', ''],
  replaceDoc: [' and replaced by a new tube;', ';'],
  replaceSvc: ['        Sample replacement = samples.save(Sample.waiting(samples.nextBarcode(), sample.getOrderId(), sample.getSampleType()));\n        sample.replaceWith(replacement.getBarcode());\n', ''],
  replaceSvcDoc: ['    /** Rejected (haemolysed, clotted, too little, wrong label): a new tube with a new barcode replaces it. */', '    /** Rejected: haemolysed, clotted, too little, wrong label. */'],
  replaceView: ['s.getRejectReason(), s.getReplacedBy(),', 's.getRejectReason(),'],
  replaceRecord: ['        String rejectReason,\n        String replacedBy,\n', '        String rejectReason,\n'],
  replaceTest: [cut(`${TEST}/sample/SampleServiceTest.java`, '\n\n    @Test\n    void aRejectedTubeIsReplacedByANewOne', '\n}\n'), ''],
  replaceModel: ['  replacedBy: string | null;\n', ''],
  replaceFe: ["${done.replacedBy ? ` · nuova provetta ${done.replacedBy}` : ''}", ''],
  // CUP_LAB-113: MediAgenda not answering ended in a 500 with a stack trace in the patient field
  peerPatient: ['        } catch (HttpClientErrorException.NotFound e) {\n            return Optional.empty();\n        } catch (ResourceAccessException e) {\n            throw new PeerUnavailableException("MediAgenda", e);\n        }',
    '        } catch (HttpClientErrorException.NotFound e) {\n            return Optional.empty();\n        }'],
  peerSearch: ['        try {\n            Page page = http.get().uri("/api/patients?q={q}&page=0&size=8", q).retrieve().body(Page.class);\n            return page == null ? List.of() : page.items();\n        } catch (ResourceAccessException e) {\n            throw new PeerUnavailableException("MediAgenda", e);\n        }',
    '        Page page = http.get().uri("/api/patients?q={q}&page=0&size=8", q).retrieve().body(Page.class);\n        return page == null ? List.of() : page.items();'],
  peerImports: ['import com.medilab.common.PeerUnavailableException;\n', ''],
  peerImports2: ['import org.springframework.web.client.ResourceAccessException;\n', ''],
  // CUP_LAB-115: the results API for the other apps returned values that were not validated yet
  validatedOnly: ['findByOrderIdInAndValidatedTrue(', 'findByOrderIdIn('],
  validatedOnlyTest: ['\n\n        service.save("RL-2026-00058", List.of(entry("CREA", "0.80")));\n        assertThat(service.ofPatient("FRRGLI90E50A794K", null)).isEmpty(); // entered, not validated yet', ''],
  // CUP_LAB-117: the report showed 2.5 / 1.0 (dot, decimals of the value) instead of 2,50 / 1,00
  reportValue: ['<td class="num">{{ value(row) }}</td>', '<td class="num">{{ row.value }}</td>'],
  reportImport: ["import { formatDecimal, rangeLabel } from '../../shared/utils/numbers';", "import { rangeLabel } from '../../shared/utils/numbers';"],
  reportMethod: ['  value(row: ResultRow): string {\n    return formatDecimal(row.value, row.decimals);\n  }\n\n', ''],
  // CUP_LAB-119: editing the patient name after picking kept the old patient (and its id) in the form
  pickerReset: ['    // The text no longer names the chosen patient: the form must not keep sending the old patientId.\n    if (this.chosen) {\n      this.chosen = null;\n      this.picked.emit(null);\n    }\n', ''],
  pickerDoc: [' * Emits the chosen patient, and null as soon as the text no longer is that patient (edited or cleared).\n', ' * Emits the chosen patient.\n'],
};

// Features that came later than the files they live in.
const LATER = {
  // CUP_LAB-114: results of a patient for the other apps
  ofPatient: [cut(`${BE}/result/ResultService.java`, '    /** Validated results of a patient', '    private LabOrder order(String id)'), ''],
  ofPatientRepo: ['\n    List<Result> findByOrderIdInAndValidatedTrue(Collection<String> orderIds);\n', ''],
  ofPatientRepoImport: ['import java.util.Collection;\n', ''],
  byFiscalCode: ['    List<LabOrder> findByFiscalCodeIgnoreCase(String fiscalCode);\n\n', ''],
  ofPatientTest: [cut(`${TEST}/result/ResultServiceTest.java`, '\n\n    @Test\n    void patientResultsAreValidatedAndCarryTheirUnit', '\n}\n'), ''],
  // Before CUP_LAB-118 creatinine was in µmol/L: Marino Paolo's 2,50 mg/dL was stored as 221 µmol/L
  creaValue: ['isEqualByComparingTo("2.50")', 'isEqualByComparingTo("221")'],
  creaUnit: ['isEqualTo("mg/dL");\n        assertThat(crea.get(0).flag())', 'isEqualTo("µmol/L");\n        assertThat(crea.get(0).flag())'],
  // Tests of later features and fixes
  sexTest: [cut(`${TEST}/result/ResultServiceTest.java`, '    @Test\n    void flagsWithTheRangeOfThePatientsSex', '    @Test\n    void roundsToTheDecimalsOfTheCatalog'), ''],
  validTest: [cut(`${TEST}/result/ResultServiceTest.java`, '    @Test\n    void validationNeedsAValueForEveryTest', '    @Test\n    void validationReportsTheRequest'), ''],
  // CUP_LAB-116: requests reported on a day (for the MediBill import)
  dayDoc: ['    /**\n     * Newest first. `status` and `q` (patient name or fiscal code) are optional; `from`/`to` (inclusive) filter on\n     * the report date, for MediBill\'s daily import of reported requests.\n     */',
    '    /** Newest first. `status` and `q` (patient name or fiscal code) are optional. */'],
  daySignature: ['    public List<OrderView> list(String status, String q, LocalDate from, LocalDate to) {', '    public List<OrderView> list(String status, String q) {'],
  dayFilters: ['                .filter(o -> from == null || (o.getReportedAt() != null && !o.getReportedAt().toLocalDate().isBefore(from)))\n                .filter(o -> to == null || (o.getReportedAt() != null && !o.getReportedAt().toLocalDate().isAfter(to)))\n', ''],
  dayImport: ['import java.time.LocalDate;\n', ''],
  dayController: [cut(`${BE}/order/OrderController.java`, '    /** GET /api/orders?status=', '\n\n    @GetMapping("/{id}")'),
    '    /** GET /api/orders?status=REFERTATA&q=ross (both optional). */\n    @GetMapping\n    public List<OrderView> list(@RequestParam(required = false) String status, @RequestParam(required = false) String q) {\n        return service.list(status, q);\n    }'],
  dayControllerImport: ['import org.springframework.format.annotation.DateTimeFormat;\n', ''],
  dayTest: [cut(`${TEST}/order/OrderServiceTest.java`, '    @Test\n    void listsTheRequestsReportedOnADay', '    @Test\n    void searchesByPatientNameOrFiscalCode'), ''],
  dayTestCall1: ['service.list(null, "marino", null, null)', 'service.list(null, "marino")'],
  dayTestCall2: ['service.list("", "frrgli", null, null)', 'service.list("", "frrgli")'],
};
const DAY = [LATER.dayDoc, LATER.daySignature, LATER.dayFilters, LATER.dayImport];
const DAY_CONTROLLER = [LATER.dayController, LATER.dayImport, LATER.dayControllerImport];
const DAY_TEST = [LATER.dayTest, LATER.dayTestCall1, LATER.dayTestCall2, LATER.dayImport];
const REPLACE_SAMPLE = [BUG.replaceField, BUG.replaceMethod, BUG.replaceGetter, BUG.replaceDoc];
const REPLACE_SERVICE = [BUG.replaceSvc, BUG.replaceSvcDoc, BUG.replaceView];
const BEFORE_118 = [LATER.creaValue, LATER.creaUnit];

export const STEPS = [
  {
    who: 'giorgio', date: '2026-03-02T10:00:00+01:00',
    message: 'CUP_LAB-101: backend skeleton and test catalog API (Flyway V1)\n\nGET /api/exams lists the active tests (code, sample type, unit, reference range by sex, tariff code, price).',
    files: {
      '.gitignore': T, 'README.md': H('01-backend'), 'backend/pom.xml': T, [YML]: B(T, [MEDISUITE, '']),
      [`${BE}/MediLabApplication.java`]: T, [`${BE}/common/ApiError.java`]: T, [`${BE}/common/NotFoundException.java`]: T,
      [GEH]: B(T, [H_BAD, ''], [H_CONFLICT, ''], [H_PEER, '']),
      [`${BE}/catalog/Exam.java`]: T, [`${BE}/catalog/ExamRepository.java`]: T, [`${BE}/catalog/ExamController.java`]: T,
      [`${MIG}/V1__exam_catalog.sql`]: T,
    },
  },
  {
    who: 'francesca', date: '2026-03-09T15:00:00+01:00',
    message: 'Frontend skeleton: Angular 18 app shell, layout, routing and the Catalogo esami page',
    files: {
      'frontend/package.json': T, 'frontend/angular.json': T, 'frontend/tsconfig.json': T, 'frontend/tsconfig.app.json': T, 'frontend/proxy.conf.json': T,
      'frontend/src/index.html': T, 'frontend/src/main.ts': T, 'frontend/src/styles.scss': T,
      [`${FE}/app.config.ts`]: T, [`${FE}/app.component.ts`]: T,
      [ROUTES]: B(T, ["redirectTo: 'richieste'", "redirectTo: 'catalogo'"], [R_LIST, ''], [R_NEW, ''], [R_SAMPLES, ''], [R_RESULTS, ''], [R_REPORT, '']),
      [`${FE}/core/http/api.ts`]: T, [`${FE}/core/http/api-errors.ts`]: T, [`${FE}/core/i18n/labels.ts`]: T,
      [`${FE}/core/layout/header.component.ts`]: T, [NAV]: B(T, [L_LIST, ''], [L_NEW, ''], [L_SAMPLES, '']),
      [`${FE}/shared/models/lab.models.ts`]: B(T, BUG.replaceModel), [`${FE}/shared/utils/numbers.ts`]: T,
      [`${FE}/features/catalog/exam-catalog.component.ts`]: T,
    },
  },
  {
    who: 'luca', date: '2026-03-16T11:30:00+01:00',
    message: 'CUP_LAB-102: test requests for MediAgenda patients, one tube per sample type (Flyway V2, V3)\n\nPOST /api/orders takes a MediAgenda patientId: the patient is read from MediAgenda (GET /api/patients/{id}) and\ncopied into the request. GET /api/mediagenda/patients?q= is the patient search of the form (MediAgenda registry).',
    files: {
      [YML]: T, [`${BE}/common/BadRequestException.java`]: T, [`${BE}/common/ConflictException.java`]: T, [GEH]: B(T, [H_PEER, '']),
      [`${BE}/integration/PatientInfo.java`]: T, [`${BE}/integration/MediAgendaClient.java`]: T,
      [`${BE}/integration/HttpMediAgendaClient.java`]: B(T, BUG.peerPatient, BUG.peerSearch, BUG.peerImports, BUG.peerImports2),
      [`${BE}/integration/PatientLookupController.java`]: T,
      [`${BE}/order/OrderStatus.java`]: T, [`${BE}/order/LabOrder.java`]: T, [`${BE}/order/OrderRequest.java`]: T, [`${BE}/order/CancelRequest.java`]: T,
      [`${BE}/order/OrderView.java`]: T, [`${BE}/order/LabOrderRepository.java`]: B(T, LATER.byFiscalCode),
      [`${BE}/order/OrderService.java`]: B(T, BUG.twice, BUG.cancelTubes, ...DAY), [`${BE}/order/OrderController.java`]: B(T, ...DAY_CONTROLLER),
      [`${BE}/sample/Sample.java`]: B(T, ...REPLACE_SAMPLE), [`${BE}/sample/SampleRepository.java`]: T,
      [`${MIG}/V2__orders.sql`]: T, [`${MIG}/V3__samples.sql`]: T,
      [`${TEST}/integration/FakeMediAgendaClient.java`]: H('03-orders'),
      [`${TEST}/order/OrderServiceTest.java`]: B(T, BUG.twiceTest, BUG.cancelTubesTest, ...DAY_TEST),
    },
  },
  {
    who: 'francesca', date: '2026-03-24T16:10:00+01:00',
    message: 'CUP_LAB-102: Richieste list and Nuova richiesta form with the MediAgenda patient picker',
    files: {
      [ROUTES]: B(T, [R_SAMPLES, ''], [R_RESULTS, ''], [R_REPORT, '']), [NAV]: B(T, [L_SAMPLES, '']),
      [`${FE}/shared/services/mediagenda-api.service.ts`]: T, [`${FE}/shared/validators/form-validators.ts`]: T,
      [`${FE}/shared/components/patient-picker/patient-picker.component.ts`]: B(T, BUG.pickerReset, BUG.pickerDoc),
      [`${FE}/features/orders/order-api.service.ts`]: T,
      [`${FE}/features/orders/order-list.component.ts`]: B(T, BUG.allValue, BUG.allDefault),
      [`${FE}/features/orders/order-form.component.ts`]: B(T, BUG.urgent),
    },
  },
  {
    who: 'luca', date: '2026-04-08T09:45:00+02:00',
    message: 'CUP_LAB-103: a test chosen twice no longer fails the request with error 500\n\n"Profilo renale" adds CREA, and the operator often ticks CREA by hand as well: the request had CREA twice and the\nduplicate key in order_items ended in a 500. The codes are now de-duplicated (the test is done and charged once).',
    files: { [`${BE}/order/OrderService.java`]: B(T, BUG.cancelTubes, ...DAY), [`${TEST}/order/OrderServiceTest.java`]: B(T, BUG.cancelTubesTest, ...DAY_TEST) },
  },
  {
    who: 'francesca', date: '2026-04-14T14:20:00+02:00',
    message: 'CUP_LAB-104: Richieste shows every request when no status is chosen\n\nThe "Tutte" option had the value TUTTE, which was sent as a status filter, so the list opened empty.',
    files: { [`${FE}/features/orders/order-list.component.ts`]: T },
  },
  {
    who: 'alessandro', date: '2026-04-21T10:30:00+02:00',
    message: 'CUP_LAB-105: tube acceptance API: scan, accept, reject with a reason\n\nWhen no tube of a request is waiting any more, the request is IN_LAVORAZIONE.',
    files: {
      [`${BE}/sample/SampleService.java`]: B(T, BUG.openCheck, ...REPLACE_SERVICE), [`${BE}/sample/SampleView.java`]: B(T, BUG.replaceRecord),
      [`${BE}/sample/RejectRequest.java`]: T, [`${BE}/sample/SampleController.java`]: T,
      [`${TEST}/sample/SampleServiceTest.java`]: B(T, BUG.openCheckTest, BUG.openCheckTestImports, BUG.openCheckTestField, BUG.replaceTest),
    },
  },
  {
    who: 'francesca', date: '2026-04-29T15:40:00+02:00',
    message: 'CUP_LAB-105: Accettazione campioni page (barcode scanner, ACCETTA / RIFIUTA)',
    files: {
      [ROUTES]: B(T, [R_RESULTS, ''], [R_REPORT, '']), [NAV]: T,
      [`${FE}/features/samples/sample-api.service.ts`]: T, [`${FE}/features/samples/sample-acceptance.component.ts`]: B(T, BUG.upper, BUG.replaceFe),
    },
  },
  {
    who: 'francesca', date: '2026-05-06T11:05:00+02:00',
    message: 'CUP_LAB-106: Accettazione campioni finds a barcode typed in lower case\n\nThe labels are printed in upper case, but a scanner with Caps Lock off sends lb00000850, which was not found.',
    files: { [`${FE}/features/samples/sample-acceptance.component.ts`]: B(T, BUG.replaceFe) },
  },
  {
    who: 'giorgio', date: '2026-05-18T10:15:00+02:00',
    message: 'CUP_LAB-107: results with reference ranges by sex, validation and report API (Flyway V4)\n\nPUT /api/orders/{id}/results stores the values (rounded to the decimals of the test) and flags them L / N / H with\nthe range for the patient\'s sex; POST /api/orders/{id}/validate signs them and the request is REFERTATA.',
    files: {
      [`${BE}/result/Flags.java`]: B(T, BUG.female), [`${BE}/result/Result.java`]: T,
      [`${BE}/result/ResultRepository.java`]: B(T, LATER.ofPatientRepo, LATER.ofPatientRepoImport), [`${BE}/result/ResultEntry.java`]: T,
      [`${BE}/result/ValidateRequest.java`]: T, [`${BE}/result/ResultSheet.java`]: T,
      [`${BE}/result/ResultService.java`]: B(T, BUG.missing, BUG.missingDoc, LATER.ofPatient), [`${BE}/result/ResultController.java`]: T,
      [`${MIG}/V4__results.sql`]: T,
      [`${TEST}/result/ResultServiceTest.java`]: B(T, LATER.sexTest, LATER.validTest, LATER.ofPatientTest),
    },
  },
  {
    who: 'francesca', date: '2026-05-27T16:30:00+02:00',
    message: 'CUP_LAB-107: Inserimento risultati and Referto pages',
    files: {
      [ROUTES]: T, [`${FE}/features/results/result-api.service.ts`]: T, [`${FE}/features/results/result-entry.component.ts`]: H('07-results'),
      [`${FE}/features/reports/report-view.component.ts`]: B(T, BUG.reportValue, BUG.reportImport, BUG.reportMethod),
    },
  },
  {
    who: 'giorgio', date: '2026-06-09T09:30:00+02:00',
    message: 'CUP_LAB-108: results of women are flagged with the female reference range\n\nThe range was chosen with sex "FEMALE", but MediAgenda registers the sex as "F": every patient got the male range,\nso a haemoglobin of 12,4 g/dL in a woman was flagged L. Test added for both sexes.',
    files: { [`${BE}/result/Flags.java`]: T, [`${TEST}/result/ResultServiceTest.java`]: B(T, LATER.validTest, LATER.ofPatientTest) },
  },
  {
    who: 'alessandro', date: '2026-06-16T14:00:00+02:00',
    message: 'CUP_LAB-109: tubes of a cancelled request can no longer be accepted\n\nCancelling a request left its tubes ATTESO, and accepting a tube did not look at the request: a cancelled request\nwent back to IN_LAVORAZIONE. Cancelling now cancels the waiting tubes, and only an open request accepts tubes.',
    files: {
      [`${BE}/order/OrderService.java`]: B(T, ...DAY), [`${BE}/sample/SampleService.java`]: B(T, ...REPLACE_SERVICE),
      [`${TEST}/order/OrderServiceTest.java`]: B(T, ...DAY_TEST), [`${TEST}/sample/SampleServiceTest.java`]: B(T, BUG.replaceTest),
    },
  },
  {
    who: 'francesca', date: '2026-06-23T10:50:00+02:00',
    message: 'CUP_LAB-110: Nuova richiesta saves the URGENTE priority\n\nThe checkbox was shown but the request was always sent with urgent: false.',
    files: { [`${FE}/features/orders/order-form.component.ts`]: T },
  },
  {
    who: 'giorgio', date: '2026-07-07T11:20:00+02:00',
    message: 'CUP_LAB-111: a request can be validated only when every test has a value\n\nA request with a missing value was reported, and the report showed an empty row.',
    files: { [`${BE}/result/ResultService.java`]: B(T, LATER.ofPatient), [`${TEST}/result/ResultServiceTest.java`]: B(T, LATER.ofPatientTest) },
  },
  {
    who: 'alessandro', date: '2026-07-14T15:10:00+02:00',
    message: 'CUP_LAB-112: a rejected tube is replaced by a new one (Flyway V5)\n\nAfter RIFIUTA the request waited for a tube that would never come: a new tube (new barcode) of the same type is\ncreated, and the rejected one points to it (replaced_by).',
    files: {
      [`${BE}/sample/Sample.java`]: T, [`${BE}/sample/SampleService.java`]: T, [`${BE}/sample/SampleView.java`]: T, [`${MIG}/V5__sample_replacement.sql`]: T,
      [`${TEST}/sample/SampleServiceTest.java`]: T, [`${FE}/shared/models/lab.models.ts`]: T, [`${FE}/features/samples/sample-acceptance.component.ts`]: T,
    },
  },
  {
    who: 'giorgio', date: '2026-07-22T10:00:00+02:00',
    message: 'CUP_LAB-114: results API for the other apps of the suite\n\nGET /api/patients/{fiscalCode}/results?exam=CREA: the results of a patient, newest first, each with its unit.\nAsked by MediFarma for the renal dose check (creatinine).',
    files: {
      [`${BE}/result/PatientResult.java`]: T, [`${BE}/result/PatientResultController.java`]: T,
      [`${BE}/result/ResultService.java`]: B(T, BUG.validatedOnly), [`${BE}/result/ResultRepository.java`]: B(T, BUG.validatedOnly),
      [`${BE}/order/LabOrderRepository.java`]: T, [`${TEST}/result/ResultServiceTest.java`]: B(T, BUG.validatedOnlyTest, ...BEFORE_118),
    },
  },
  {
    who: 'luca', date: '2026-08-04T09:15:00+02:00',
    message: 'CUP_LAB-113: MediAgenda not answering is reported as 502 with a message\n\nWith MediAgenda down, the patient search failed with a 500 and a stack trace. The client now reports\n"MediAgenda is not reachable" (502), and the patient field shows it.',
    files: {
      [`${BE}/common/PeerUnavailableException.java`]: T, [`${BE}/integration/HttpMediAgendaClient.java`]: T, [GEH]: T,
      [`${TEST}/integration/FakeMediAgendaClient.java`]: T, [`${TEST}/integration/PatientLookupTest.java`]: T,
    },
  },
  {
    who: 'giorgio', date: '2026-08-11T14:45:00+02:00',
    message: 'CUP_LAB-115: the results API returns validated results only\n\nMediFarma read a creatinine that was entered but not validated yet (and corrected afterwards).',
    files: { [`${BE}/result/ResultService.java`]: T, [`${BE}/result/ResultRepository.java`]: T, [`${TEST}/result/ResultServiceTest.java`]: B(T, ...BEFORE_118) },
  },
  {
    who: 'alessandro', date: '2026-09-08T10:40:00+02:00',
    message: 'CUP_LAB-116: requests API filters by report date, for the MediBill import\n\nGET /api/orders?status=REFERTATA&from=2026-11-02&to=2026-11-02: the requests reported on those days, with the\ntariff code of every test.',
    files: { [`${BE}/order/OrderService.java`]: T, [`${BE}/order/OrderController.java`]: T, [`${TEST}/order/OrderServiceTest.java`]: T },
  },
  {
    who: 'francesca', date: '2026-09-15T16:00:00+02:00',
    message: 'CUP_LAB-117: Referto shows values with a decimal comma and the decimals of the test\n\nThe report printed 2.5 and 1 (the raw number); it now prints 2,50 and 1,00 like the reference range.',
    files: { [`${FE}/features/reports/report-view.component.ts`]: T },
  },
  {
    who: 'francesca', date: '2026-09-24T11:30:00+02:00',
    message: 'CUP_LAB-119: Nuova richiesta: editing the patient after picking forgets the picked patient\n\nAfter picking "Rossi Mario" and typing another name, the request was still made for Rossi Mario.',
    files: { [`${FE}/shared/components/patient-picker/patient-picker.component.ts`]: T },
  },
  {
    who: 'alessandro', date: '2026-10-21T09:20:00+02:00',
    message: 'CUP_LAB-118: creatinine in mg/dL (Flyway V6)\n\nThe nephrology ward and the regional health record (FSE) use mg/dL. The catalog unit, decimals and ranges of CREA\nchange, and stored results are converted (1 mg/dL = 88.4 µmol/L). The results API returns every value with its\nunit, so readers of /api/patients/{fiscalCode}/results get "unit": "mg/dL" from now on.',
    files: { [`${MIG}/V6__creatinine_mg_dl.sql`]: T, [`${TEST}/result/ResultServiceTest.java`]: T },
  },
  {
    who: 'francesca', date: '2026-10-27T15:15:00+01:00',
    message: 'CUP_LAB-120: Inserimento risultati: Enter moves to the next value, no number spinners\n\nThe number fields changed a value when the mouse wheel scrolled over them, and Enter did nothing. Text fields\n(inputmode decimal) now take the value; Enter moves to the next test (the last one saves), and saved values are\nshown in the Italian format.',
    files: { [`${FE}/features/results/result-entry.component.ts`]: T },
  },
  {
    who: 'bojan', date: '2026-11-04T18:30:00+01:00',
    message: 'Browser tests: Playwright with a mocked backend API (requests, tubes, results, report)',
    files: {
      'README.md': T, 'e2e/package.json': T, 'e2e/playwright.config.ts': T, 'e2e/README.md': T,
      'e2e/support/evidence.ts': T, 'e2e/support/api-data.json': T, 'e2e/support/mock-api.ts': T, 'e2e/support/lab.ts': T,
      'e2e/tests/orders.smoke.spec.ts': T, 'e2e/tests/samples.smoke.spec.ts': T, 'e2e/tests/results.smoke.spec.ts': T,
    },
  },
];
