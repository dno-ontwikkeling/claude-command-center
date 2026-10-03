package com.olivier.commandcenter.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlertTest {
    @Test
    fun needsInputAndFinishedShowWithTheLabel() {
        assertEquals(
            Alert.Show("needs-input", "a1", "api / main"),
            Alert.parse(mapOf("type" to "needs-input", "agentId" to "a1", "label" to "api / main")),
        )
        assertEquals(
            Alert.Show("finished", "a1", null),
            Alert.parse(mapOf("type" to "finished", "agentId" to "a1", "label" to " ")),
        )
    }

    @Test
    fun dismissNamesTheKindToClear() {
        assertEquals(
            Alert.Dismiss("finished", "a1"),
            Alert.parse(mapOf("type" to "dismiss", "kind" to "finished", "agentId" to "a1")),
        )
    }

    @Test
    fun testAlertNeedsNothingElse() {
        assertEquals(Alert.Test, Alert.parse(mapOf("type" to "test")))
    }

    @Test
    fun malformedPayloadsAreIgnored() {
        assertNull(Alert.parse(emptyMap()))
        assertNull(Alert.parse(mapOf("type" to "needs-input")))
        assertNull(Alert.parse(mapOf("type" to "needs-input", "agentId" to "")))
        assertNull(Alert.parse(mapOf("type" to "dismiss", "agentId" to "a1")))
        assertNull(Alert.parse(mapOf("type" to "dismiss", "kind" to "bogus", "agentId" to "a1")))
        assertNull(Alert.parse(mapOf("type" to "nope", "agentId" to "a1")))
    }

    @Test
    fun kindsDoNotShareNotificationIds() {
        assertNotEquals(AlertNotifier.notificationId("needs-input", "a1"), AlertNotifier.notificationId("finished", "a1"))
    }
}
