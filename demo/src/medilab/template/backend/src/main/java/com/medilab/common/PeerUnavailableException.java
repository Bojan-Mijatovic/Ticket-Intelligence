package com.medilab.common;

/** Another application of the suite (e.g. MediAgenda) did not answer: reported as 502 with a readable message. */
public class PeerUnavailableException extends RuntimeException {

    public PeerUnavailableException(String application, Throwable cause) {
        super(application + " is not reachable: " + cause.getMessage(), cause);
    }
}
