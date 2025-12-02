# Dub AWS 마이그레이션 계획서

## 문서 정보

| 항목 | 내용 |
|------|------|
| **프로젝트명** | Dub - 링크 단축 및 분석 플랫폼 |
| **작성일** | 2025-12-02 |
| **버전** | 1.0 |
| **목표** | Vercel 기반 인프라 → AWS 완전 마이그레이션 |

---

## 1. 개요

### 1.1 마이그레이션 목적

1. **인프라 통합**: 모든 서비스를 AWS 단일 클라우드로 통합
2. **비용 최적화**: 트래픽 규모에 따른 비용 효율성 확보
3. **제어력 강화**: 인프라 세부 설정 및 커스터마이징 가능
4. **벤더 종속성 탈피**: Vercel, Upstash, PlanetScale 등 SaaS 의존도 제거

### 1.2 현재 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                         현재 아키텍처                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐      │
│   │   Vercel    │     │ PlanetScale │     │   Upstash   │      │
│   │  (Hosting)  │────▶│   (MySQL)   │     │   (Redis)   │      │
│   │  Edge/SSR   │     │             │     │   (QStash)  │      │
│   └──────┬──────┘     └─────────────┘     └─────────────┘      │
│          │                                                      │
│   ┌──────┴──────┐     ┌─────────────┐     ┌─────────────┐      │
│   │   Vercel    │     │  Tinybird   │     │   Resend    │      │
│   │  Cron Jobs  │     │ (Analytics) │     │   (Email)   │      │
│   │  (13 jobs)  │     │             │     │             │      │
│   └─────────────┘     └─────────────┘     └─────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 목표 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS 목표 아키텍처                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                      ┌─────────────┐                            │
│                      │  Route 53   │                            │
│                      │    (DNS)    │                            │
│                      └──────┬──────┘                            │
│                             │                                   │
│                      ┌──────▼──────┐                            │
│                      │ CloudFront  │                            │
│                      │    (CDN)    │                            │
│                      └──────┬──────┘                            │
│                             │                                   │
│         ┌───────────────────┼───────────────────┐               │
│         │                   │                   │               │
│   ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐          │
│   │  Lambda   │      │  Lambda   │      │    S3     │          │
│   │   (SSR)   │      │(Middleware)│     │ (Static)  │          │
│   │ OpenNext  │      │  @Edge    │      │  Assets   │          │
│   └─────┬─────┘      └───────────┘      └───────────┘          │
│         │                                                       │
│   ┌─────▼─────────────────────────────────────────┐            │
│   │                    VPC                         │            │
│   │  ┌───────────┐  ┌───────────┐  ┌───────────┐  │            │
│   │  │  Aurora   │  │ElastiCache│  │    SQS    │  │            │
│   │  │  MySQL    │  │   Redis   │  │  Queues   │  │            │
│   │  │Serverless │  │Serverless │  │           │  │            │
│   │  └───────────┘  └───────────┘  └───────────┘  │            │
│   └────────────────────────────────────────────────┘            │
│                                                                 │
│   ┌───────────┐  ┌───────────┐  ┌───────────┐                  │
│   │EventBridge│  │    SES    │  │CloudWatch │                  │
│   │ Scheduler │  │  (Email)  │  │(Monitoring)│                  │
│   │ (13 Cron) │  │           │  │           │                  │
│   └───────────┘  └───────────┘  └───────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 서비스 매핑 상세

### 2.1 서비스 전환 매트릭스

| 현재 서비스 | AWS 대체 서비스 | 난이도 | 변경 범위 |
|------------|----------------|--------|----------|
| Vercel Hosting | OpenNext + Lambda + CloudFront | 🟢 하 | 설정 파일 |
| Vercel Edge Functions | Lambda@Edge | 🟢 하 | 자동 변환 |
| Vercel Cron Jobs | EventBridge Scheduler | 🟢 하 | 설정 변환 |
| Vercel Edge Config | AWS AppConfig | 🟡 중 | 코드 수정 |
| Vercel Domains API | Route 53 + ACM | 🟡 중 | API 재구현 |
| PlanetScale MySQL | Aurora MySQL Serverless v2 | 🟢 하 | 연결 문자열 |
| Upstash Redis | ElastiCache Serverless | 🟡 중 | 라이브러리 교체 |
| Upstash QStash | SQS + Lambda | 🔴 상 | 아키텍처 변경 |
| Tinybird | Kinesis + Timestream (선택) | 🔴 상 | 유지 권장 |
| Resend | Amazon SES | 🟢 하 | API 교체 |
| Stripe | Stripe (유지) | - | 변경 없음 |

### 2.2 상세 전환 계획

#### A. 호스팅 (Vercel → OpenNext)

**현재 설정 (`vercel.json`):**
```json
{
  "crons": [
    { "path": "/api/cron/domains/verify", "schedule": "0 * * * *" },
    ...
  ],
  "functions": {
    "app/api/cron/**/*": { "maxDuration": 600 }
  }
}
```

**AWS 전환 (SST + OpenNext):**
```typescript
// infra/web.ts
export const web = new sst.aws.Nextjs("DubWeb", {
  path: "apps/web",
  domain: "dub.co",
  openNextVersion: "3.1.4",
  memory: "2048 MB",
  timeout: "30 seconds",
});
```

**변경 사항:**
- ✅ SSR: Lambda 자동 배포
- ✅ ISR: S3 + Lambda 자동 처리
- ✅ Middleware: Lambda@Edge 자동 변환
- ✅ Image Optimization: 별도 Lambda
- ✅ Static Assets: S3 + CloudFront

---

#### B. 데이터베이스 (PlanetScale → Aurora)

**현재 설정:**
```typescript
// packages/prisma/schema/schema.prisma
datasource db {
  provider     = "mysql"
  url          = env("DATABASE_URL")
  relationMode = "prisma"  // PlanetScale 호환
}
```

**AWS 전환:**
```typescript
// infra/database.ts
export const database = new aws.rds.Cluster("DubDatabase", {
  engine: "aurora-mysql",
  engineMode: "provisioned",
  serverlessv2ScalingConfiguration: {
    minCapacity: 0.5,
    maxCapacity: 16,
  },
});
```

**변경 사항:**
- `DATABASE_URL` 환경 변수만 변경
- RDS Proxy로 Lambda 연결 풀링
- `relationMode = "prisma"` 제거 가능 (FK 지원)

**마이그레이션 절차:**
1. Aurora 클러스터 생성
2. PlanetScale에서 mysqldump 또는 DMS로 데이터 이전
3. Prisma 스키마 검증 (`npx prisma db pull`)
4. 연결 문자열 전환

---

#### C. 캐시 (Upstash Redis → ElastiCache)

**현재 코드:**
```typescript
// lib/upstash.ts
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 사용 예
await redis.get("key");
await redis.set("key", value, { ex: 3600 });
```

**AWS 전환:**
```typescript
// lib/redis.ts
import { Redis } from "ioredis";

export const redis = new Redis(process.env.REDIS_URL, {
  tls: {},
  maxRetriesPerRequest: 3,
});

// 사용법 동일
await redis.get("key");
await redis.set("key", value, "EX", 3600);
```

**변경 필요 파일:**
- `lib/upstash.ts` → `lib/redis.ts`
- Rate limiting 로직 (`@upstash/ratelimit` → 자체 구현 또는 유지)

**주의사항:**
- Upstash는 HTTP 기반, ElastiCache는 TCP 기반
- VPC 내부에서만 접근 가능 → Lambda VPC 설정 필수

---

#### D. 메시지 큐 (QStash → SQS)

**현재 코드:**
```typescript
// lib/qstash.ts
import { Client } from "@upstash/qstash";

export const qstash = new Client({
  token: process.env.QSTASH_TOKEN,
});

// 사용 예
await qstash.publishJSON({
  url: `${APP_URL}/api/webhooks/process`,
  body: { eventId: "123" },
  delay: 60,
});
```

**AWS 전환:**
```typescript
// lib/sqs.ts
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({ region: "us-east-1" });

export async function enqueue(queueUrl: string, body: object, delaySeconds?: number) {
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(body),
    DelaySeconds: delaySeconds,
  }));
}
```

**아키텍처 변경:**
```
현재: QStash → HTTP Webhook → API Route
전환: SQS → Lambda Consumer → 직접 처리
```

**변경 필요 파일:** 20-30개 (모든 QStash 사용처)

---

#### E. Cron Jobs (Vercel → EventBridge)

**현재 설정 (`vercel.json`):**
```json
{
  "crons": [
    { "path": "/api/cron/domains/verify", "schedule": "0 * * * *" },
    { "path": "/api/cron/domains/email-verify", "schedule": "0 * * * *" },
    { "path": "/api/cron/domains/renewal-reminders", "schedule": "0 8 * * *" },
    { "path": "/api/cron/domains/renewal-charge", "schedule": "0 8 * * *" },
    { "path": "/api/cron/workspaces/update-clicks", "schedule": "* * * * *" },
    { "path": "/api/cron/partners/update-stats", "schedule": "*/2 * * * *" },
    { "path": "/api/cron/usage", "schedule": "0 12 * * *" },
    { "path": "/api/cron/aggregate-clicks", "schedule": "0 0 * * *" },
    { "path": "/api/cron/partners/send-summary", "schedule": "0 13 1 * *" },
    { "path": "/api/cron/commissions/aggregate", "schedule": "0 * * * *" },
    { "path": "/api/cron/payouts/notify-balance", "schedule": "0 14 * * *" },
    { "path": "/api/cron/payouts/notify-program-owner", "schedule": "0 13 25-31,1-5 * *" },
    { "path": "/api/cron/programs/update-similarity", "schedule": "0 */12 * * *" }
  ]
}
```

**AWS 전환 (SST Cron):**
```typescript
// infra/cron.ts
new sst.aws.Cron("VerifyDomains", {
  schedule: "rate(1 hour)",
  job: {
    handler: "apps/web/functions/cron/domains-verify.handler",
    timeout: "10 minutes",
  },
});
```

**변경 사항:**
- API Route → Lambda 함수로 추출
- Vercel Cron → EventBridge Scheduler
- 인증 로직 변경 (Vercel 서명 → IAM)

---

#### F. 이메일 (Resend → SES)

**현재 코드:**
```typescript
// lib/resend.ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: "noreply@dub.co",
  to: email,
  subject: "Welcome to Dub",
  react: WelcomeEmail({ name }),
});
```

**AWS 전환:**
```typescript
// lib/ses.ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { render } from "@react-email/render";

const ses = new SESv2Client({ region: "us-east-1" });

export async function sendEmail({ to, subject, react }) {
  const html = render(react);

  await ses.send(new SendEmailCommand({
    FromEmailAddress: "noreply@dub.co",
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Html: { Data: html } },
      },
    },
  }));
}
```

**변경 사항:**
- React Email 템플릿 그대로 사용
- API 호출 부분만 변경
- SES 도메인 검증 필요

---

#### G. 분석 (Tinybird) - 유지 권장

**이유:**
- Tinybird → AWS 전환 복잡도 매우 높음
- 실시간 분석 파이프라인 재구축 필요
- 기존 쿼리 전체 재작성

**권장 방안:**
1. **Phase 1**: Tinybird 유지
2. **Phase 2**: 필요시 Kinesis + Timestream으로 점진적 전환

---

## 3. 마이그레이션 단계

### Phase 1: 준비 (Week 1-2)

| 작업 | 설명 | 담당 |
|------|------|------|
| 1.1 | SST 프로젝트 초기화 | DevOps |
| 1.2 | AWS 계정 설정 (IAM, VPC) | DevOps |
| 1.3 | 개발 환경 구축 | DevOps |
| 1.4 | CI/CD 파이프라인 설정 | DevOps |

**산출물:**
- `sst.config.ts`
- `infra/` 디렉토리 구조
- GitHub Actions 워크플로우

### Phase 2: 인프라 구축 (Week 3-4)

| 작업 | 설명 | 담당 |
|------|------|------|
| 2.1 | VPC 및 네트워크 배포 | DevOps |
| 2.2 | Aurora MySQL 클러스터 생성 | DevOps |
| 2.3 | ElastiCache Redis 생성 | DevOps |
| 2.4 | SQS 큐 생성 | DevOps |
| 2.5 | S3 버킷 생성 | DevOps |
| 2.6 | SES 도메인 설정 | DevOps |

**산출물:**
- AWS 인프라 리소스
- 연결 테스트 결과

### Phase 3: 코드 수정 (Week 5-7)

| 작업 | 설명 | 담당 |
|------|------|------|
| 3.1 | Redis 클라이언트 교체 | Backend |
| 3.2 | 이메일 서비스 교체 | Backend |
| 3.3 | QStash → SQS 전환 | Backend |
| 3.4 | 환경 변수 정리 | Backend |
| 3.5 | Cron Job Lambda 추출 | Backend |

**산출물:**
- 수정된 코드베이스
- 단위 테스트 통과

### Phase 4: 데이터 마이그레이션 (Week 8)

| 작업 | 설명 | 담당 |
|------|------|------|
| 4.1 | PlanetScale → Aurora 데이터 이전 | DBA |
| 4.2 | S3 자산 마이그레이션 | DevOps |
| 4.3 | 데이터 무결성 검증 | QA |

**산출물:**
- 마이그레이션 완료 보고서
- 데이터 검증 결과

### Phase 5: 스테이징 테스트 (Week 9-10)

| 작업 | 설명 | 담당 |
|------|------|------|
| 5.1 | 스테이징 환경 배포 | DevOps |
| 5.2 | 통합 테스트 | QA |
| 5.3 | 성능 테스트 | QA |
| 5.4 | 보안 테스트 | Security |

**산출물:**
- 테스트 결과 보고서
- 성능 벤치마크

### Phase 6: 프로덕션 전환 (Week 11-12)

| 작업 | 설명 | 담당 |
|------|------|------|
| 6.1 | DNS 전환 계획 수립 | DevOps |
| 6.2 | 블루-그린 배포 | DevOps |
| 6.3 | 트래픽 점진적 전환 | DevOps |
| 6.4 | 모니터링 및 롤백 대기 | All |

**산출물:**
- 프로덕션 배포 완료
- 모니터링 대시보드

---

## 4. 상세 기술 명세

### 4.1 인프라 코드 구조

```
dub/
├── sst.config.ts              # SST 메인 설정
├── infra/
│   ├── vpc.ts                 # VPC, 서브넷, 보안 그룹
│   ├── database.ts            # Aurora MySQL, RDS Proxy
│   ├── cache.ts               # ElastiCache Redis
│   ├── queue.ts               # SQS 큐 (6개)
│   ├── email.ts               # SES 설정
│   ├── storage.ts             # S3 버킷, CloudFront
│   ├── web.ts                 # OpenNext, Lambda, CloudFront
│   ├── cron.ts                # EventBridge Scheduler
│   └── monitoring.ts          # CloudWatch, 알람
├── apps/web/
│   ├── functions/
│   │   ├── cron/              # Cron Lambda 핸들러
│   │   │   ├── domains-verify.ts
│   │   │   ├── domains-email-verify.ts
│   │   │   └── ...
│   │   └── consumers/         # SQS Consumer 핸들러
│   │       ├── email.ts
│   │       ├── webhook.ts
│   │       └── analytics.ts
│   └── lib/
│       ├── redis.ts           # ElastiCache 클라이언트
│       ├── sqs.ts             # SQS 클라이언트
│       └── ses.ts             # SES 클라이언트
└── .github/workflows/
    └── sst-deploy.yml         # CI/CD 파이프라인
```

### 4.2 환경 변수 매핑

| 현재 변수 | AWS 변수 | 설명 |
|----------|---------|------|
| `DATABASE_URL` | `DATABASE_URL` | Aurora 연결 문자열 |
| `UPSTASH_REDIS_REST_URL` | `REDIS_URL` | ElastiCache 연결 |
| `UPSTASH_REDIS_REST_TOKEN` | (불필요) | IAM 인증 사용 |
| `QSTASH_TOKEN` | `SQS_QUEUE_URL` | SQS 큐 URL |
| `RESEND_API_KEY` | (불필요) | IAM 인증 사용 |
| `STORAGE_ENDPOINT` | `S3_BUCKET` | S3 버킷 이름 |

### 4.3 AWS 리소스 비용 예상

#### 월간 예상 비용 (프로덕션)

| 서비스 | 사양 | 예상 비용 (USD) |
|--------|------|----------------|
| **Lambda** | 10M 요청, 512MB | $50-100 |
| **CloudFront** | 100GB 전송 | $10-20 |
| **Aurora Serverless** | 2-8 ACU 평균 | $100-300 |
| **ElastiCache Serverless** | 1-5GB | $30-100 |
| **SQS** | 10M 메시지 | $5-10 |
| **SES** | 100K 이메일 | $10-20 |
| **S3** | 100GB 저장 | $3-5 |
| **Route 53** | 호스팅 존 + 쿼리 | $5-10 |
| **CloudWatch** | 로그 + 메트릭 | $20-50 |
| **VPC** | NAT Gateway | $30-50 |
| **총계** | | **$263-665** |

**비교:**
- Vercel Pro: $20/user + 사용량
- PlanetScale: $29+/월
- Upstash: 사용량 기반
- Tinybird: 사용량 기반

---

## 5. 위험 관리

### 5.1 위험 요소 및 대응

| 위험 | 영향 | 확률 | 대응 방안 |
|------|------|------|----------|
| **데이터 손실** | 🔴 치명 | 🟢 낮음 | 마이그레이션 전 전체 백업, 병행 운영 |
| **서비스 중단** | 🔴 치명 | 🟡 중간 | 블루-그린 배포, 즉시 롤백 계획 |
| **성능 저하** | 🟡 심각 | 🟡 중간 | 성능 테스트, 오토스케일링 설정 |
| **비용 초과** | 🟡 심각 | 🟡 중간 | 비용 알람, Reserved Instance |
| **보안 취약점** | 🔴 치명 | 🟢 낮음 | 보안 감사, WAF 설정 |

### 5.2 롤백 계획

**단계별 롤백:**

1. **DNS 롤백** (5분)
   - Route 53에서 Vercel로 CNAME 복원

2. **트래픽 롤백** (즉시)
   - CloudFront에서 원본 Vercel로 변경

3. **데이터베이스 롤백** (30분)
   - Aurora 스냅샷에서 복원
   - PlanetScale 다시 활성화

4. **전체 롤백** (1시간)
   - 모든 환경 변수 원복
   - Vercel 배포 재활성화

---

## 6. 체크리스트

### 6.1 마이그레이션 전 체크리스트

- [ ] AWS 계정 생성 및 IAM 설정
- [ ] 도메인 소유권 확인 (Route 53 전환 준비)
- [ ] SSL 인증서 발급 (ACM)
- [ ] VPC CIDR 계획 수립
- [ ] 데이터베이스 백업 완료
- [ ] 현재 트래픽 패턴 분석
- [ ] 비용 예측 및 예산 승인

### 6.2 마이그레이션 후 체크리스트

- [ ] 모든 API 엔드포인트 동작 확인
- [ ] 인증/로그인 플로우 테스트
- [ ] 결제 플로우 테스트 (Stripe)
- [ ] 이메일 발송 테스트
- [ ] Cron Job 실행 확인
- [ ] 성능 메트릭 정상 범위 확인
- [ ] 에러율 모니터링
- [ ] 비용 모니터링 알람 설정

---

## 7. 부록

### 7.1 파일 변경 목록

**신규 생성 파일:**
- `sst.config.ts`
- `infra/*.ts` (9개 파일)
- `apps/web/functions/cron/*.ts` (13개 파일)
- `apps/web/functions/consumers/*.ts` (3개 파일)
- `.github/workflows/sst-deploy.yml`

**수정 파일:**
- `apps/web/lib/upstash.ts` → `redis.ts`
- `apps/web/lib/qstash.ts` → `sqs.ts`
- `apps/web/lib/resend.ts` → `ses.ts`
- `packages/prisma/schema/schema.prisma`
- `apps/web/.env.example`

### 7.2 참고 문서

- [OpenNext Documentation](https://open-next.js.org/)
- [SST v3 Documentation](https://sst.dev/)
- [AWS Aurora Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)
- [ElastiCache Serverless](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/serverless.html)

### 7.3 연락처

| 역할 | 담당자 | 연락처 |
|------|--------|--------|
| 프로젝트 관리 | TBD | - |
| DevOps | TBD | - |
| Backend | TBD | - |
| QA | TBD | - |

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 1.0 | 2025-12-02 | 초기 작성 | Claude |
