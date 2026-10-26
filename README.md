# ThrottleX ⚡

**A Redis-backed API rate-limiting and traffic control system built with Node.js and Express.**

ThrottleX explores how backend services can control incoming API traffic, enforce request limits, and evaluate rate-limiting strategies through repeatable load tests. It implements three rate-limiting algorithms and includes benchmark reporting, validation, and comparison utilities.

## 🚀 Features

- **Three rate-limiting algorithms:** Fixed Window, Sliding Window, and Token Bucket.
- **Redis integration:** Supports shared rate-limit state through Redis.
- **Configurable request limits:** Control request allowances and time windows.
- **API traffic protection:** Test rate-limit behavior and HTTP `429 Too Many Requests` responses.
- **Load testing:** Uses Autocannon to measure throughput and response latency.
- **Repeatable benchmarks:** Runs multiple rounds to compare performance more consistently.
- **Benchmark reporting:** Saves benchmark results as JSON reports.
- **Report validation:** Checks report structure and required benchmark fields.
- **Comparison utilities:** Compares benchmark results across algorithms and test scenarios.
- **Automated tests:** Uses Vitest and Supertest to test backend behavior.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | REST API and middleware |
| Redis | Rate-limit state management |
| Autocannon | HTTP load testing |
| Vitest | Automated testing |
| Supertest | HTTP endpoint testing |
| Docker | Running Redis locally |
| JavaScript (ES Modules) | Backend implementation |

## 🧠 Rate-Limiting Algorithms

### 1. Fixed Window

Divides time into fixed intervals and tracks the number of requests within each interval.

**Best for:** Simple request quotas with low implementation overhead.

### 2. Sliding Window

Tracks requests across a moving time window to provide smoother rate-limit enforcement around window boundaries.

**Best for:** Reducing the boundary effects associated with fixed windows.

### 3. Token Bucket

Allows requests while tokens are available and replenishes tokens according to a configured refill policy.

**Best for:** Supporting controlled bursts while maintaining a long-term request rate.

## 🏗️ Project Structure

```text
ThrottleX/
├── backend/
│   ├── src/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── app.js
│   │   └── server.js
│   ├── benchmarks/
│   │   ├── rate-limiter.bench.js
│   │   ├── validate-reports.js
│   │   ├── compare-benchmark-reports.js
│   │   └── results/
│   ├── tests/
│   ├── package.json
│   └── .env.example
├── .gitignore
└── README.md
```

*Note: The tree shows the main components and may need adjustment to match the repository's exact file layout.*

## ⚙️ Getting Started

### Prerequisites

Install the following before running the project:

- [Node.js](https://nodejs.org/)
- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or a local Redis installation
- npm, included with Node.js

### 1. Clone the repository

```bash
git clone https://github.com/sourodeep004/ThrottleX.git
cd ThrottleX
```

Replace the repository URL above if your actual GitHub repository uses a different owner or name.

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure environment variables

Create a `.env` file inside the `backend/` directory using the project's `.env.example` as a reference.

```bash
cp .env.example .env
```

Configure the variables required by your implementation, such as the server port and Redis connection URL. Use the actual variable names defined in your project.

**Important:** Never commit `.env` files, credentials, or production secrets to GitHub.

### 4. Start Redis

If the project uses a Docker container named `throttlex-redis`, start it with:

```bash
docker start throttlex-redis
```

If the container has not been created yet, use the Redis setup documented in your project. For example, a local development container can be started with:

```bash
docker run -d --name throttlex-redis -p 6379:6379 redis
```

If the container already exists, do not create another container with the same name.

### 5. Start the backend

```bash
npm run dev
```

For a production-style start:

```bash
npm start
```

The server's port and available endpoints depend on your environment configuration and route definitions.

## 🔌 API Endpoints

The following endpoints reflect the routes used during development. Confirm the exact paths in your current code before publishing this section.

| Endpoint | Purpose |
|---|---|
| `GET /` | Returns API information |
| `GET /api/health` | Health check |
| `/api/demo` | Demonstrates rate-limiting algorithms |
| `/api/benchmark/sliding-window` | Exercises Sliding Window behavior |
| `/api/benchmark/token-bucket` | Exercises Token Bucket behavior |

The project also includes benchmark-running and reporting functionality. Consult the route definitions for the exact paths and HTTP methods supported by your current version.

## 📊 Benchmarking

ThrottleX uses **Autocannon** to generate HTTP traffic and collect performance metrics.

The benchmark workflow supports repeated test rounds and JSON report generation. The measured metrics include:

- Requests per second
- Median response latency
- p50, p97.5, and p99 latency
- Successful HTTP responses (`2xx`)
- Rate-limited responses (`429`)
- Server errors (`5xx`)
- Request errors and timeouts

### Run a benchmark

From the `backend/` directory:

```bash
npm run benchmark
```

### Validate benchmark reports

```bash
node benchmarks/validate-reports.js
```

### Compare benchmark reports

```bash
node benchmarks/compare-benchmark-reports.js
```

Run these commands from the directory expected by the project's scripts. Check `backend/package.json` if a script name differs.

### Interpreting results

Benchmark results depend on the machine, Redis configuration, network overhead, request concurrency, test duration, and endpoint behavior. For a fair comparison, keep the test configuration consistent across algorithms and report the environment alongside the results.

Do not interpret a high-limit throughput test as proof of production capacity. It measures behavior under its specific workload.

## 🧪 Testing

Run the automated test suite from `backend/`:

```bash
npm test
```

If the project exposes a separate coverage script, run:

```bash
npm run coverage
```

Check `package.json` for the exact available scripts.

## 🔒 Security and Reliability Considerations

- Keep secrets and environment files out of version control.
- Validate incoming configuration and request parameters.
- Use appropriate security middleware and CORS configuration.
- Test rate-limit behavior under concurrent requests.
- Verify Redis connection failure handling and application recovery.
- Ensure that rate-limit state is shared appropriately when multiple application instances are running.
- Avoid treating local benchmark results as production guarantees.

## 🔭 Future Improvements

Potential next steps include:

- Add a dashboard for visualizing benchmark results.
- Compare rate-limiting behavior under different concurrency levels.
- Add distributed multi-instance tests.
- Evaluate behavior during Redis outages and recovery.
- Add configurable policies per API key or user.
- Integrate continuous integration to run tests and validate benchmark reports automatically.
- Add API documentation and deployment instructions.

## 🎯 Project Goals

ThrottleX is designed as a backend engineering project focused on:

- Middleware design and request lifecycle management
- Rate-limiting algorithms and Redis integration
- HTTP performance testing and latency analysis
- Automated testing and benchmark validation
- Reproducible performance comparisons

## 👨‍💻 Author

**Sourodeep Saha**

- GitHub: [@sourodeep004](https://github.com/sourodeep004)

## 📄 License

Choose and add a license before distributing the project publicly. If you select the MIT License, add a `LICENSE` file containing its terms and update this section accordingly.
