package handlers

import (
	"bugmark/internal/models"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"testing"
	"time"
)

func hourlyTestJob() models.MarketplaceJob {
	return models.MarketplaceJob{BillingType: "hourly", HourlyRate: 2500, Budget: 10000, MaxSeconds: 8 * 3600, ScopePriceMode: "domain", ScopeTasks: []models.MarketplaceScopeTask{{TaskID: primitive.NewObjectID()}}}
}

func TestHourlyLimitsAndRounding(t *testing.T) {
	j := hourlyTestJob()
	if err := validateHourlyJob(j); err != nil {
		t.Fatal(err)
	}
	if hourlySecondLimit(j) != 4*3600 {
		t.Fatal("cost cap did not limit hours")
	}
	for _, tc := range []struct{ seconds, amount int64 }{{0, 0}, {1, 1}, {36, 25}, {3600, 2500}, {4 * 3600, 10000}, {1000000, 10000}, {-20, 0}} {
		if got := hourlyAmount(j, tc.seconds); got != tc.amount {
			t.Errorf("%d seconds: got %d want %d", tc.seconds, got, tc.amount)
		}
	}
	j.MaxSeconds = 2 * 3600
	if hourlySecondLimit(j) != 2*3600 || hourlyAmount(j, 1000000) != 5000 {
		t.Fatal("hour cap not enforced")
	}
	j.HourlyRate = 999
	j.Budget = 100
	j.MaxSeconds = 3600
	if hourlyAmount(j, hourlySecondLimit(j)) > 100 {
		t.Fatal("fractional rate exceeds wallet cap")
	}
}

func TestHourlyTimerDeadlineAndResume(t *testing.T) {
	start := time.Date(2026, 9, 6, 10, 0, 0, 0, time.UTC)
	until := start.Add(time.Hour)
	j := hourlyTestJob()
	j.TrackedSeconds = 3 * 3600
	j.TimerStartedAt = &start
	j.TimerUntil = &until
	if got := hourlySeconds(j, start.Add(30*time.Minute)); got != 12600 {
		t.Fatalf("resume total %d", got)
	}
	if got := hourlySeconds(j, start.Add(24*time.Hour)); got != 14400 {
		t.Fatalf("closed browser exceeded deadline: %d", got)
	}
	if got := hourlySeconds(j, start.Add(-time.Hour)); got != 10800 {
		t.Fatal("future start subtracts recorded time")
	}
}

func TestInvalidHourlyContracts(t *testing.T) {
	for name, change := range map[string]func(*models.MarketplaceJob){
		"missing scope":            func(j *models.MarketplaceJob) { j.ScopeTasks = nil },
		"conflicting prices":       func(j *models.MarketplaceJob) { j.ScopePriceMode = "per_task" },
		"negative rate":            func(j *models.MarketplaceJob) { j.HourlyRate = -1 },
		"missing limit":            func(j *models.MarketplaceJob) { j.MaxSeconds = 0 },
		"excessive limit":          func(j *models.MarketplaceJob) { j.MaxSeconds = 36000001 },
		"missing cap":              func(j *models.MarketplaceJob) { j.Budget = 0 },
		"fixed with hourly fields": func(j *models.MarketplaceJob) { j.BillingType = "fixed" },
		"unknown type":             func(j *models.MarketplaceJob) { j.BillingType = "unknown" },
	} {
		t.Run(name, func(t *testing.T) {
			j := hourlyTestJob()
			change(&j)
			if validateHourlyJob(j) == nil {
				t.Fatal("accepted invalid contract")
			}
		})
	}
	if err := validateHourlyJob(models.MarketplaceJob{}); err != nil {
		t.Fatal("legacy fixed job rejected", err)
	}
}

func TestHourlySettlementConservesReservedFunds(t *testing.T) {
	j := hourlyTestJob()
	for _, seconds := range []int64{0, 1, 3600, 1000000} {
		amount := hourlyAmount(j, seconds)
		fee := marketplaceFee(amount)
		net := amount - fee
		returned := j.Budget - amount
		if net < 0 || returned < 0 || net+fee+returned != j.Budget {
			t.Fatal("settlement does not conserve reserve")
		}
	}
}
