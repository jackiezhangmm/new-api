package relay

import (
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel/task/apimart"
	"github.com/QuantumNous/new-api/relay/channel/task/autodl"
	"github.com/stretchr/testify/require"
)

func TestGetTaskAdaptorAutoDL(t *testing.T) {
	adaptor := GetTaskAdaptor(constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeAutoDL)))
	_, ok := adaptor.(*autodl.TaskAdaptor)
	require.True(t, ok)
}

func TestGetTaskAdaptorAPIMart(t *testing.T) {
	adaptor := GetTaskAdaptor(constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeAPIMart)))
	_, ok := adaptor.(*apimart.TaskAdaptor)
	require.True(t, ok)
}
