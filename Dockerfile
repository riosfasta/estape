FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /out/bugmega ./cmd/server

FROM alpine:3.21
WORKDIR /app
COPY --from=build /out/bugmega /app/bugmega
COPY web /app/web
RUN mkdir -p /app/uploads
ENV PORT=8080
EXPOSE 8080
CMD ["/app/bugmega"]
